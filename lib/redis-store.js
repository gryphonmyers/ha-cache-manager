const CacheStore = require('./cache-store');
const redis = require('redis');
const { promisify } = require('util');
const defaults = require('defaults-es6');

module.exports = class RedisStore extends CacheStore {

    constructor(opts={}) {
        opts = defaults(opts, {
            redisImplementation: redis
        })
        super({isPrimary: opts.isPrimary});
        this.client = opts.redisImplementation.createClient(opts);
    }

    async has(key) {
        return promisify(this.client.exists)(key);
    }

    async getMetadata(key) {
        var val = await promisify(this.client.get)(`${key}_meta`);
        return JSON.parse(val);
    }

    async setMetadata(key, value) {
        return promisify(this.client.set)(`${key}_meta`, JSON.stringify(value));
    }

    async mset() {
        var args = Array.from(arguments);
        var timestamps = args.length % 2 ? args.splice(-1, 1)[0] : null;

        await promisify(this.client.mset)(
            ...args.map((arg, ii) => ii % 2 ? JSON.stringify(arg) : arg), 
            ...args.map((arg, ii) => ii % 2 ? JSON.stringify({ setTime: timestamps[Math.floor(ii / 2)] }) : `${arg}_meta`)
        )
    }

    async mget() {
        var keys = Array.from(arguments);
        var vals = await promisify(this.client.mget)(...keys);

        return vals.map(val => JSON.parse(val));
    }

    async mdel() {
        var keys = Array.from(arguments);
        return Promise.all(keys.map(key => promisify(this.client.del)(key)))
    }

    async del(key) {
        return promisify(this.client.del)(key);
    }

    async set(key, value, timestamp) {
        return Promise.all([
            promisify(this.client.set)(key, JSON.stringify(value)),
            this.setMetadata(key, {setTime: timestamp})
        ])
        .then(() => value)
    }

    async get(key) {
        var val = await promisify(this.client.get)(key);
        return JSON.parse(val);
    }

    async keys(pattern='*') {
        return promisify(this.client.keys)(pattern);
    }

    async values() {
        var keys = await this.keys();

        return this.mget(...keys)
    }
}