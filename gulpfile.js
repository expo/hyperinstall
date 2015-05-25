var gulp = require('gulp');
var changed = require('gulp-changed');
var coffee = require('gulp-coffee');
var insert = require('gulp-insert');
var gutil = require('gulp-util');

var paths = {
  coffee: ['src/**/*.coffee'],
};

gulp.task('coffee', function () {
  var dest = 'lib';
  return gulp.src(paths.coffee)
    .pipe(changed(dest, {extension: '.js'}))
    .pipe(coffee({bare: true}).on('error', gutil.log))
    .pipe(insert.prepend('/* @' + 'generated */'))
    .pipe(gulp.dest(dest))
    ;
});

gulp.task('watch', function () {
  gulp.watch(paths.coffee, ['coffee']);
});

gulp.task('default', ['coffee']);
