module.exports = {
  extends: ['universe/shared/core', 'universe/shared/prettier'],
  plugins: ['node'],
  env: { node: true },
  rules: {
    'no-buffer-constructor': 'warn',
    'node/no-path-concat': 'warn',
  },
};
