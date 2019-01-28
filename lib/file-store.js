const path = require('path');
const fs = require('mz/fs');
const mkdirp = require('mkdirp-then');
const CacheStore = require('./cache-store');

module.exports = class FileStore extends CacheStore {

    constructor({isPrimary, path='tmp'}={}) {
        super({isPrimary});
        this.path = path;
    }

    async has(key) {
        return fs.stat(path.join(this.path, key + '.json')).then(() => true).catch(() => false);
    }

    async getMetadata(key) {
        return fs.readFile(path.join(this.path, key + '_meta.json'))
            .catch(() => 'null')
            .then(data => JSON.parse(data));
    }

    async setMetadata(key, value) {
        return fs.writeFile(path.join(this.path, key + '_meta.json'), JSON.stringify(value));
    }
    
    async mset() {
        var args = Array.from(arguments);
        var timestamps = args.length % 2 ? args.splice(-1, 1)[0] : null;

        var pairs = args.reduce((acc, curr, ii, orig) => ii % 2 ? [...acc, [orig[ii - 1], orig[ii]]] : acc, []);

        await mkdirp(this.path)

        return Promise.all([
            ...pairs.map(async (pair, ii) =>  fs.writeFile(path.join(this.path, `${pair[0]}_meta.json`), JSON.stringify({ setTime: timestamps[ii] }))),
            ...pairs.map((pair) => fs.writeFile(path.join(this.path, `${pair[0]}.json`), JSON.stringify(pair[1])))
        ])
    }

    async mdel() {
        var keys = Array.from(arguments);
        var timestamps = Array.isArray(keys[keys.length - 1]) ? keys.splice(-1, 1)[0] : null;

        return Promise.all([
            ...keys.map((key, ii) => fs.writeFile(path.join(this.path, `${key}_meta.json`), JSON.stringify({ setTime: timestamps[ii] }))),
            ...keys.map((key) => fs.unlink(path.join(this.path, `${key}.json`)))
        ])
    }

    async get(key) {
        var filePath = path.join(this.path, key + '.json');

        return fs.readFile(filePath)
            .catch(err => "null")
            .then(data => {
                return JSON.parse(data);
            });
    }

    async keys(pattern='*') {
        // @TODO implement pattern filtering
        await mkdirp(this.path)
        var files = await fs.readdir(this.path);

        return files.map(item => path.parse(item).name);
    }

    async values() {
        await mkdirp(this.path)
        return fs.readdir(this.path)
                .then(items =>
                    Promise.all(
                        items.map(item => path.parse(item).name)
                            .map(key => this.get(key))
                    )
                    .then(
                        items => items.filter(val => 
                            val != null && ('k' in val && 'e' in val && 'v' in val)
                        )
                    )
                )
    }
}