const path = require('path');
const fs = require('mz/fs');
const mkdirp = require('mkdirp-then');
const CacheStore = require('./cache-store');
const minimatch = require('minimatch');

module.exports = class FileStore extends CacheStore {

    constructor({path='tmp'}={}) {
        super();
        this.path = path;
    }

    async has(key) {
        if (this.writePromises[key]) {
            return !!this.hasValues[key];
        } else {
            return fs.stat(path.join(this.path, this.constructor.hashKey(key) + '.json')).then(() => true).catch(() => false);
        }   
    }

    async getMetadata(key) {
        return fs.readFile(path.join(this.path, this.constructor.hashKey(key) + '_meta.json'))
            .catch(() => 'null')
            .then(data => JSON.parse(data))
            .catch(() => null)
    }

    async setMetadata(key, value) {
        return fs.writeFile(path.join(this.path, this.constructor.hashKey(key) + '_meta.json'), JSON.stringify(value));
    }    
    
    async set(key, val, timestamp) {
        await mkdirp(this.path)
        //THIS CAN STILL BE AN ISSUE IF OTHER PROCESSES (e.g. other cache instances) ARE WRITING TO THE SAME LOCATION
        return this.queueWrite(key, () => 
            Promise.all([
                this.setMetadata(key, { setTime: timestamp, key }),
                fs.writeFile(path.join(this.path, `${this.constructor.hashKey(key)}.json`), JSON.stringify(val))
            ])
            .then(() => true)
        )
    }

    async mset() {
        var args = Array.from(arguments);
        var timestamps = args.length % 2 ? args.splice(-1, 1)[0] : null;
        var pairs = args.reduce((acc, curr, ii, orig) => ii % 2 ? [...acc, [orig[ii - 1], orig[ii]]] : acc, []);

        return Promise.all(pairs.map(async (pair, ii) => this.set(pair[0], pair[1], timestamps[ii])))
    }

    /**
     * @private
     */
    async delSingle(key, timestamp) {
        await mkdirp(this.path);
        return this.queueWrite(key, () =>
            Promise.all([
                this.setMetadata(key, { setTime: timestamp, key }),
                fs.unlink(path.join(this.path, `${this.constructor.hashKey(key)}.json`)).catch(() => null)
            ])
            .then(() => false)
        )
    }

    async del() {
        var keys = Array.from(arguments);
        var timestamps = Array.isArray(keys[keys.length - 1]) ? keys.splice(-1, 1)[0] : [];
        
        return Promise.all(keys.map((key, ii) => this.delSingle(key, timestamps[ii])));
    }

    static validateValue(val) {
        return val != null && typeof val === 'object' && ('k' in val && 'e' in val && 'v' in val);
    }

    async get(key) {
        var fileName = this.constructor.hashKey(key) + '.json';
        var filePath = path.join(this.path, fileName);
        await mkdirp(this.path)

        return fs.readFile(filePath)
            .then(data => {
                try {
                    var val = JSON.parse(data);
                    if (!this.constructor.validateValue(val)) {
                        throw new Error(`Invalid value ${val}`);
                    }
                    return val;
                } catch (err) {
                    fs.unlink(filePath).catch(() => null)
                    return null;
                }
            })
            .catch(err => null)
    }

    async mget() {
        var keys = Array.from(arguments);

        return Promise.all(keys.map(key => this.get(key)))
    }

    async keys(pattern='*') {
        await mkdirp(this.path)
        var files = await fs.readdir(this.path);

        return Promise.all(files.map(item => path.parse(item))
            .filter(parsedPath => parsedPath.name.slice(-5) === '_meta' && minimatch(parsedPath.name.slice(0, -5), pattern))
            .map(parsedPath => {
                return fs.readFile(path.join(this.path, `${parsedPath.name}.json`))
                    .then(contents => {
                        return JSON.parse(contents).key;
                    })
            }))
    }

    async values() {
        await mkdirp(this.path)
        var keys = await this.keys()
        return Promise.all(keys.map(key => this.get(key)))
    }
}