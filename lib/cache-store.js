module.exports = class CacheStore {

    constructor({isPrimary=false} = {}) {
        this.isPrimary = isPrimary;
    }

    async mget() {}
    async has(key) {}
    async set(key, value) {}
    async mset() {}
    async get(key) {}
    async mdel() {}
    async del() {}
    async values() {}
    async keys() {}

    async getMetadata(key) {}
    async setMetadata(key) {}

    async checkIfHasNewer(key, setTime) {
        var [ hasValue, metadata] = await Promise.all([
            this.has(key),
            this.getMetadata(key)
        ])
        if (hasValue && metadata && (!setTime || metadata.setTime > setTime)) {
            return true;
        }
        return false;
    }

}