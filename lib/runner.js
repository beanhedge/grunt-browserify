var _ = require('lodash');
var path = require('path');
var resolve = require('resolve');
var glob = require('glob');

module.exports = GruntBrowserifyRunner;

function GruntBrowserifyRunner(options) {
  this.browserify = options.browserify;
  this.watchify = options.watchify;
  this.logger = options.logger;
  this.writer = options.writer;
  this.firstBuild = true;
}

GruntBrowserifyRunner.prototype = _.create(GruntBrowserifyRunner.prototype, {
  run: function (files, destination, options, next) {
    var self = this;

    //set constructor options and instantiate
    var bOpts = _.cloneDeep(options.browserifyOptions) || {};
    bOpts.entries = bOpts.entries || files;

    // Watchify requires specific arguments
    if(options.watch) {
      bOpts = _.extend({ cache: {}, packageCache: {}, fullPaths: true }, bOpts);
    }

    //determine watchify or browserify
    var b = options.watch ? this.watchify(this.browserify(bOpts)) : this.browserify(bOpts);

    b.on('error', function (err) {
      self.logger.fail.warn(err);
    });

    if(options.bundleOptions) {
      throw new Error('bundleOptions is no longer used. Move all option in browserifyOptions.');
    }

    // concat both array of require and alias
    var requiredFiles = (options.require || []).concat(options.alias || []);
    _.forEach(requiredFiles, function (file) {
      var filePair = file.split(':');
      b.require(filePair[0], {expose: filePair.length === 1 ? filePair[0] : filePair[1]});
    });

    if (options.exclude) {
      _.forEach(options.exclude, function (file) {
        runOptionForGlob(b, 'exclude', file);
      });
    }

    if (options.ignore) {
      _.forEach(options.ignore, function (file) {
        runOptionForGlob(b, 'ignore', file);
      });
    }

    if (options.external) {
      _.forEach(options.external, function (id) {
        //allow externalizing of alias lists
        if (id.match(':')) {
          id = id.split(':')[1];
        }

        if (testForGlob(id)) {
          runOptionForGlob(b, 'external', id);
        }
        else {
          b.external(id);
        }
      });
    }

    if (options.transform) {
      _.forEach(options.transform, function (transformer) {
        if (typeof transformer !== 'object') {
          b.transform(transformer);
        }
        else {
          b.transform(transformer[1], transformer[0]);
        }
      });
    }

    if (options.plugin) {
      _.forEach(options.plugin, function (plugin) {
        if (typeof plugin !== 'object') {
          b.plugin(plugin);
        }
        else {
          b.plugin(plugin[0], plugin[1]);
        }
      });
    }


    var destPath = this.createDestDir(destination);
    var keepAlive = this.keepAliveFn.bind(this, options);
    var done = options.keepAlive? keepAlive : next;
    var bundleComplete = this.onBundleComplete(destination, options, done);

    if (options.watch) {
      var bundleUpdate = this.onBundleComplete(destination, options, keepAlive);
      b.on('update', function (ids) {
        ids.forEach(function (id) {
          self.logger.log.ok(id + ' changed, updating browserify bundle.');
        });
        doBundle(b, options, bundleUpdate);
      });
    }

    doBundle(b, options, bundleComplete);
  },

  createDestDir: function (destination) {
    var destPath = path.dirname(path.resolve(destination));
    if (!this.writer.exists(destPath)) {
      this.writer.mkdir(destPath);
    }
    return destPath;
  },

  keepAliveFn: function (options) {
    this.logger.log.ok('Watchifying...');
  },

  onBundleComplete: function (destination, options, next) {
    var self = this;
    return function (err, buf) {
      if (err) {
        self.logger.log.error(err);
        if (self.firstBuild || !options.keepAlive) {
          self.logger.fail.warn('Error running grunt-browserify.');
        }
      }
      else if (buf) {
          // prepend the banner
          if(options.banner) {
              buf = Buffer.concat([new Buffer(options.banner + '\n', 'utf8'), buf]);
          }

        self.writer.write(destination, buf);
      }

      self.firstBuild = false;
      next();
    };
  }
});

function doBundle(browserifyInstance, opts, bundleComplete) {
  if (opts.preBundleCB) {
    opts.preBundleCB(browserifyInstance);
  }

  browserifyInstance.bundle(function (err, buf) {
    if (opts.postBundleCB) {
      opts.postBundleCB(err, buf, bundleComplete);
    }
    else {
      bundleComplete(err, buf);
    }
  });
}

function testForGlob(id) {
  return (/\*/.test(id));
}

function runOptionForGlob(browserifyInstance, method, pattern) {
  var files = glob.sync(pattern);
  if (!files || files.length < 1) {
    //it's not a glob, it's a file / module path
    files = [pattern];
  }
  files.forEach(function (f) {
    browserifyInstance[method].call(browserifyInstance, f);
  });
}
