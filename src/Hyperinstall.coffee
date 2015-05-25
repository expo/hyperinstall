require 'instapromise'

_ = require 'lodash-node'
childProcess = require 'child_process'
co = require 'co'
crypto = require 'crypto'
digestStream = require 'digest-stream'
fs = require 'fs'
fstreamNpm = require 'fstream-npm'
npmPackageArg = require 'npm-package-arg'
path = require 'path'
rimraf = require 'rimraf'
streamToPromise = require 'stream-to-promise'
util = require 'util'

AwaitLock = require 'await-lock'

STATE_FILE = '.hyperinstall-state.json'
CONFIG_FILE = 'hyperinstall.json'

class Hyperinstall

  constructor: (@root) ->
    @forceInstallation = false
    @state = {}
    @updatedPackages = {}
    @installLock = new AwaitLock

  # Global cache breaker to force updating all packages
  cacheBreaker: 0

  createPackageListAsync: co.wrap ->
    filename = path.join @root, CONFIG_FILE
    yield return fs.promise.writeFile filename, '{\n}\n'

  installAsync: co.wrap ->
    [@state, packages] = yield [
      @readInstallationStateAsync()
      @readPackageListAsync()
    ]

    if @state.cacheBreaker != @cacheBreaker
      yield _.map packages, (cacheBreaker, name) =>
        updatePackageAsync = co.wrap =>
          deps = yield @readPackageDepsAsync name
          return @updatePackageAsync name, cacheBreaker, deps
        updatePackageAsync()
    else
      yield _.map packages, (cacheBreaker, name) =>
        @updatePackageIfNeededAsync name, cacheBreaker

    if not _.isEmpty @updatedPackages
      count = _.keys(@updatedPackages).length
      packageWord = if count is 1 then 'package' else 'packages'
      console.log 'Updated %d %s:', count, packageWord
      for name of @updatedPackages
        console.log '  %s', name

    # Update the installation state
    @state.cacheBreaker = @cacheBreaker

    @state.packages ?= {}
    _.assign @state.packages, @updatedPackages
    for name of @state.packages
      if name not of packages
        delete @state.packages[name]

    yield @writeInstallationStateAsync @state

  readInstallationStateAsync: co.wrap ->
    filename = path.join @root, STATE_FILE
    try
      contents = yield fs.promise.readFile filename, encoding: 'utf8'
    catch e
      if e.code is 'ENOENT'
        return {}
      throw e
    JSON.parse(contents)

  writeInstallationStateAsync: co.wrap (state) ->
    contents = JSON.stringify state
    filename = path.join @root, STATE_FILE
    yield return fs.promise.writeFile filename, contents, encoding: 'utf8'

  readPackageListAsync: co.wrap ->
    filename = path.join @root, CONFIG_FILE
    try
      contents = yield fs.promise.readFile filename, encoding: 'utf8'
    catch e
      if e.code is 'ENOENT'
        console.warn 'Specify the packages to install in ' + CONFIG_FILE + '.'
        return {}
      throw e
    JSON.parse(contents)

  updatePackageIfNeededAsync: co.wrap (name, cacheBreaker) ->
    deps = yield @readPackageDepsAsync name
    unversionedDepChecksums = yield @readUnversionedDepChecksumsAsync name, deps
    if @forceInstallation
      yield @removeNodeModulesDirAsync name
      return @updatePackageAsync name, cacheBreaker, deps, unversionedDepChecksums
    else
      return unless @packageNeedsUpdate name, cacheBreaker, deps, unversionedDepChecksums
      return @updatePackageAsync name, cacheBreaker, deps, unversionedDepChecksums

  updatePackageAsync: co.wrap (name, cacheBreaker, deps, unversionedDepChecksums) ->
    packagePath = path.resolve @root, name
    yield @installLock.acquireAsync()
    console.log 'Package "%s" has been updated; installing...', name
    try
      yield @promise.execNpmInstall packagePath
      console.log 'Finished installing "%s"\n', name
    finally
      @installLock.release()

    @updatedPackages[name] =
      cacheBreaker: cacheBreaker
      dependencies: deps
      unversionedDependencyChecksums: unversionedDepChecksums

  removeNodeModulesDirAsync: co.wrap (name) ->
    nodeModulesPath = path.resolve @root, name, 'node_modules'
    yield rimraf.promise nodeModulesPath
    console.log 'Removed node_modules for "%s"\n', name

  readPackageDepsAsync: co.wrap (name) ->
    packageJSONPath = path.resolve @root, name, 'package.json'
    packageJSON = yield fs.promise.readFile packageJSONPath, encoding: 'utf8'
    packageJSON = JSON.parse packageJSON

    packageDeps = {}
    _.assign packageDeps, packageJSON.dependencies ? {}
    _.assign packageDeps, packageJSON.devDependencies ? {}

  readUnversionedDepChecksumsAsync: co.wrap (name, deps) ->
    packagePath = path.resolve @root, name
    unversionedDeps = @filterLocalDeps name, deps
    promises = {}
    for dep, depPath of unversionedDeps
      absoluteDepPath = path.resolve packagePath, depPath
      console.log absoluteDepPath
      promises[dep] = @readPackageChecksumAsync absoluteDepPath
    return yield promises

  filterLocalDeps: (name, deps) ->
    # Change the working directory since npm-package-arg uses it when calling
    # path.resolve
    originalCwd = process.cwd()
    packagePath = path.resolve @root, name
    process.chdir packagePath

    localDeps = {}
    try
      for dep, version of deps
        descriptor = npmPackageArg "#{ dep }@#{ version }"
        if descriptor.type is 'local'
          localDeps[dep] = descriptor.spec
    finally
      process.chdir originalCwd
    return localDeps

  readPackageChecksumAsync: (packagePath) ->
    return new Promise (resolve, reject) =>
      fileChecksumPromises = {}
      fileListStream = fstreamNpm path: packagePath

      fileListStream.on 'child', (entry) =>
        absoluteFilePath = entry.props.path
        relativeFilePath = path.relative packagePath, absoluteFilePath
        fileChecksumPromises[relativeFilePath] = @readFileChecksumAsync absoluteFilePath, 'sha1'

      fileListStream.on 'error', (error) ->
        fileListStream.removeAllListeners()
        reject error

      fileListStream.on 'end', ->
        fileListStream.removeAllListeners()
        resolve co ->
          fileChecksums = yield fileChecksumPromises
          # Compute a stable hash of the hashes
          hashStream = crypto.createHash 'sha1'
          for checksum in _.sortBy fileChecksums
            hashStream.update checksum, 'utf8'
          return hashStream.digest 'hex'

  readFileChecksumAsync: (filePath, algorithm) ->
    return new Promise (resolve, reject) ->
      fs.createReadStream filePath
        .on 'error', reject
        .pipe digestStream algorithm, 'hex', (digest) ->
          resolve digest
        .on 'error', reject

  packageNeedsUpdate: (name, cacheBreaker, deps, unversionedDepChecksums) ->
    packageState = @state.packages?[name]
    return true unless packageState
    return true unless packageState.cacheBreaker == cacheBreaker

    installedDeps = packageState.dependencies
    return true unless _.isEqual deps, installedDeps

    installedUnversionedDepChecksums = packageState.unversionedDependencyChecksums
    not _.isEqual unversionedDepChecksums, installedUnversionedDepChecksums

  execNpmInstall: (packagePath, callback) ->
    child = childProcess.spawn 'npm', ['install'], {
      cwd: packagePath
      stdio: 'inherit'
    }

    child.on 'error', (err) ->
      child.removeAllListeners()
      callback err

    child.on 'exit', (code, signal) ->
      child.removeAllListeners()
      if code
        message = util.format 'npm install failed in %s', packagePath
        err = new Error message
        err.errno = code
        err.code = signal
      callback err, code

  cleanAsync: co.wrap ->
    stateFilename = path.join @root, STATE_FILE
    yield return fs.promise.unlink stateFilename

module.exports = Hyperinstall
