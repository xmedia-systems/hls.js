const pkgJson = require('./package.json');
const path = require('path');
const webpack = require('webpack');

const buildConstants = {
    __VERSION__: JSON.stringify(pkgJson.version),
    __USE_SUBTITLES__: true,
    __USE_ALT_AUDIO__: true,
    __USE_EME_DRM__: false,
};

const plugins = [
    new webpack.DefinePlugin(buildConstants),
    new webpack.optimize.ModuleConcatenationPlugin()
];

const baseConfig = {
  entry: './src/hls.js',
  node: false,
  optimization: {
    splitChunks: false
  },
  module: {
    strictExportPresence: true,
    rules: [
      {
        test: /\.js$/,
        exclude: [
          path.resolve(__dirname, 'node_modules')
        ],
        loader: 'babel-loader',
        options: {
            babelrc: false,
            presets: [
                ['env', {
                    // Output the babel targets/plugins used
                    // https://babeljs.io/docs/plugins/preset-env/#debug
                    // debug: true,
                    loose: true,
                    modules: 'commonjs',
                    targets: {
                        browsers: [
                            'chrome >= 55',
                            'firefox >= 51',
                            'ie >= 11',
                            'safari >= 8',
                            'ios >= 8',
                            'android >= 4'
                        ]
                    }
                }]
            ],
          plugins: [
            {
              visitor: {
                CallExpression: function (espath, file) {
                  if (espath.get('callee').matchesPattern('Number.isFinite'))
                    espath.node.callee = file.addImport(path.resolve('src/polyfills/number-isFinite'), 'isFiniteNumber');
                }
              }
            },
            'transform-object-assign'
          ]
        }
      }
    ]
  }
};

const multiConfig = [
  {
    name: 'debug',
    mode: 'development',
    output: {
      filename: 'hls.js',
      chunkFilename: '[name].js',
      sourceMapFilename: 'hls.js.map',
      path: path.resolve(__dirname, 'dist'),
      publicPath: '/dist/',
      library: 'Hls',
      libraryTarget: 'umd',
      libraryExport: 'default'
    },
    plugins,
    devtool: 'source-map'
  },
  {
    name: 'dist',
    mode: 'production',
    output: {
      filename: 'hls.min.js',
      chunkFilename: '[name].js',
      path: path.resolve(__dirname, 'dist'),
      publicPath: '/dist/',
      library: 'Hls',
      libraryTarget: 'umd',
      libraryExport: 'default'
    },
    plugins,
    devtool: 'source-map'
  },
  {
    name: 'demo',
    entry: './demo/main',
    mode: 'production',
      output: {
        filename: 'hls-demo.js',
        chunkFilename: '[name].js',
        sourceMapFilename: 'hls-demo.js.map',
        path: path.resolve(__dirname, 'dist'),
        publicPath: '/dist/',
        library: 'HlsDemo',
        libraryTarget: 'umd',
        libraryExport: 'default'
    },
    plugins: [],
    devtool: 'source-map'
  }
].map(config => Object.assign({}, baseConfig, config));

// webpack matches the --env arguments to a string; for example, --env.debug.min translates to { debug: true, min: true }
module.exports = (envArgs) => {
  if (!envArgs) {
    // If no arguments are specified, return every configuration
    return multiConfig;
  }

  // Find the first enabled config within the arguments array
  const enabledConfigName = Object.keys(envArgs).find(envName => envArgs[envName]);
  // Filter out config with name
  return multiConfig.find(config => config.name === enabledConfigName);
};
