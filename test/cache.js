const mockFs = require('mock-fs');
const MockDate = require('mockdate');
const redisMock = require('redis-mock');
const tap = require('tap');
const fs = require('mz/fs');
const { promisify } = require('util');
const rimraf = require('rimraf-then');

const Cache = require('../');
const FileStore = require('../lib/file-store');
const RedisStore = require('../lib/redis-store');

tap.test('Test cache', async test =>  {
    var cache = new Cache({
    });

    await cache.init();

    var val = await cache.wrap('foo', function(){
        return 'bar';
    });

    test.equals(val, 'bar');
})

tap.test('Test cache', async test =>  {
    var cache = new Cache({
    });

    await cache.init();

    var oldVal = await cache.wrap('foo', () => {
        return 'baz';
    })

    var val = await cache.wrap('foo', () => {
        return new Promise(resolve => {
            setTimeout(1000, () => resolve('bag'))
        });
    });

    test.equals(val, 'baz', 'Set cache has expected value');
})

tap.test('Test cache set', async test =>  {
    var cache = new Cache({
    });

    await cache.load();

    var val = await cache.set('foo', 'bar');

    test.equals(val, 'bar');

    val = await cache.set('foo', 'brick');
    val = await cache.set('foo', 'brack');

    test.equals(val, 'brack');

    cache.set('foo', 'block');

    test.equals(val, 'brack', 'Cache set without awaiting promise returns old value.');
})


tap.test('Test cache ttl', async test =>  {
    test.test('Test undefined ttl functionality', async test => {
        var cache = new Cache({
        });
    
        await cache.load();
    
        MockDate.set('2019-01-01T08:00');
    
        await cache.set('foo', 'bar');
    
        var val = await cache.get('foo');
    
        test.equals(val, 'bar');
    
        MockDate.set('2019-01-01T08:01');
    
        val = await cache.get('foo');
    
        test.equals(val, 'bar');
    
        MockDate.set('2019-02-01T08:02');
    
        val = await cache.get('foo');
    
        test.equals(val, 'bar', 'With undefined ttl, even a month later it still returns a set value.');

        MockDate.reset();
    })

    test.test('Test basic ttl functionality', async test => {
        var cache = new Cache({
            ttl: 60
        });
    
        await cache.load();
    
        MockDate.set('2019-01-01T08:00');
    
        await cache.set('foo', 'bar');
    
        var val = await cache.get('foo');
    
        test.equals(val, 'bar');
    
        MockDate.set('2019-01-01T08:01');
    
        val = await cache.get('foo');
    
        test.equals(val, 'bar');
    
        MockDate.set('2019-01-01T08:02');
    
        val = await cache.get('foo');
    
        test.equals(val, undefined);

        MockDate.reset();
    })

    test.test('Test set method ttl functionality', async test => {
        var cache = new Cache({
            ttl: 60
        });
    
        await cache.load();
    
        MockDate.set('2019-01-01T08:00');
    
        await cache.set('foo', 'bar', 120);
    
        var val = await cache.get('foo');
    
        test.equals(val, 'bar');
    
        MockDate.set('2019-01-01T08:02');
    
        val = await cache.get('foo');
    
        test.equals(val, 'bar');
    
        MockDate.set('2019-01-01T08:03');
    
        val = await cache.get('foo');
    
        test.equals(val, undefined);

        MockDate.reset();
    })

    test.test('Test wrap method ttl functionality', async test => {
        var cache = new Cache({
            ttl: 60
        });
    
        await cache.load();
    
        MockDate.set('2019-01-01T08:00');
    
        await cache.wrap('foo', () => Promise.resolve('bar'), {ttl: 120});

        var val = await cache.get('foo');
    
        test.equals(val, 'bar');
    
        MockDate.set('2019-01-01T08:02');
        
        await cache.wrapPromises.foo
        val = await cache.get('foo');
        
        test.equals(val, 'bar');
    
        MockDate.set('2019-01-01T08:03');
    
        val = await cache.get('foo');
    
        test.equals(val, undefined);

        MockDate.reset();
    })

    test.test('Test cache ttl as function', async test =>  {
        var cache = new Cache({
            ttl: function(key, value) {
                return value === 'bar' ? 60 : 120
            }
        });
    
        await cache.load();
    
        MockDate.set('2019-01-01T08:00');
    
        await cache.set('foo', 'bar');
    
        MockDate.set('2019-01-01T08:02');
    
        var val = await cache.get('foo');
    
        test.equals(val, undefined, 'When using conditional value from function, ttl is shorter.');
    
        val = await cache.set('foo', 'buzz');
    
        test.equals(val, 'buzz');
    
        MockDate.set('2019-01-01T08:04');
    
        val = await cache.get('foo');
    
        test.equals(val, 'buzz');
    
        MockDate.set('2019-01-01T08:05');
    
        val = await cache.get('foo');
    
        test.equals(val, undefined, 'Alternate control flow yields a longer ttl.');

        MockDate.reset();
    })
})

tap.test('Test cache wrap', async test =>  {
    test.test('Test false returnStaleWhileRefreshing', async test => {
        var cache = new Cache({
            returnStaleWhileRefreshing: false,
            ttl: 59
        });
        MockDate.set('2019-01-01T08:00');
    
        var val = await cache.set('foo', 'buzz');

        var promise = cache.wrap('foo', () => new Promise(async resolve => {
            MockDate.set('2019-01-01T08:01');
            val = await cache.get('foo');
    
            test.equals(val, undefined);
            resolve('bag')
            val = await promise;
            
            test.equals(val, 'bag');

            MockDate.reset();
        }));
    })

    test.test('Test true returnStaleWhileRefreshing', async test => {
        var cache = new Cache({
            returnStaleWhileRefreshing: true,
            ttl: 60
        });
        MockDate.set('2019-01-01T08:00');
    
        var val = await cache.set('foo', 'buzz');
    
        MockDate.set('2019-01-01T08:01');

        var promise = cache.wrap('foo', () => new Promise(async resolve => {
            val = await cache.get('foo');
    
            test.equals(val, 'buzz');
            resolve('bag')
            val = await promise;
            
            test.equals(val, 'bag');

            MockDate.reset();
        }));
    })
})

tap.test('Test file store', async test =>  {
    MockDate.set('2019-01-01T08:00');
    mockFs();

    var cache = new Cache({
        ttl: 59,
        stores: [new FileStore]
    });
    await cache.load();

    await cache.set('foo', 'bar');

    await cache.dumpPromise;

    items = await fs.readdir('tmp');

    test.equals(items.length, 2);
    
    var fileContents = await fs.readFile('tmp/8c736521.json');

    test.deepEquals(JSON.parse(fileContents.toString('utf8')), {"k":"foo","v":"bar","e":1546358459000});

    mockFs.restore();

    MockDate.reset();
});

tap.test('Test set to file store with extremely long key', async test =>  {
    const longKey = 'feed_nba-media_video_lang=enUS&locale=en-US&secret=null&date=null&filter%5Bpromoted%5D=true&filter%5B%24and%5D%5B0%5D%5Btags%5D%5B%24ne%5D=MyTeam&filter%5B%24and%5D%5B1%5D%5Btags%5D%5B%24ne%5D=Playgrounds&filter%5B%24and%5D%5B2%5D%5Btags%5D%5B%24ne%5D=2KTV&skip=0&limit=8&sort%5BpublishDate%5D=-1&flatten=true&token=70bd7b40f30df772747d598dfb898f&populate=20&simple=true__temp_meta';
    var cache = new Cache({
        ttl: 59,
        stores: [new FileStore({path:'tmp5'})]
    });
    await cache.load();

    await cache.set(longKey, 'bar');

    await cache.dumpPromise;

    items = await fs.readdir('tmp5');

    test.equals(items.length, 2);
    
    await rimraf('tmp5');
});

tap.test('Test file store keys', async test =>  {
    var cache = new Cache({
        ttl: 59,
        stores: [new FileStore({path:'tmp6'})]
    });
    await cache.load();

    await cache.set('foo', 'bar');
    await cache.set('plus', 'minus');

    await cache.dumpPromise;

    var keys = await cache.stores[0].keys();

    test.deepEquals(keys, ['foo', 'plus']);
    
    await rimraf('tmp6');
});

tap.test('Test refresh with no initial values', async test =>  {
    MockDate.set('2019-01-01T08:00');

    var cache = new Cache({
        ttl: 59,
        stores: [new FileStore({isPrimary: true, path: 'tmp4'})]
    });

    await cache.load()

    var val = await cache.wrap('foo', () => Promise.resolve('bar'))
    
    test.equals(val, 'bar');

    await cache.dumpPromise
    await rimraf('tmp4');

    MockDate.reset();
});

tap.test('Test multi / primary store with files', async test =>  {
    MockDate.set('2019-01-01T08:00');

    mockFs();

    var commonStore = new FileStore({path: 'tmp2', isPrimary: true})

    var cache = new Cache({
        ttl: 59, stores: [commonStore]
    });

    var cache2 = new Cache({
        ttl: 59, stores: [new FileStore, commonStore]
    });

    // var items = await fs.readdir('tmp');

    // test.equals(items.length, 0);

    // items = await fs.readdir('tmp2');

    // test.equals(items.length, 0);

    await cache2.set('foo', 'bar');

    await cache2.dumpPromise

    var val = await cache.get('foo');
    /* todo test when we have returnStaleWhileRefreshing false */
    /* todo test when not isprimary */
    test.equals(val, undefined);

    await cache.refreshPromises.foo

    val = await cache.get('foo');

    test.equals(val, 'bar');

    await cache.dumpPromise;

    var items = await fs.readdir('tmp');
    var items2 = await fs.readdir('tmp2');

    test.deepEquals(items, items2, 'Both file stores have same files');

    mockFs.restore();

    MockDate.reset();
});

tap.test('Test redis store', async test =>  {
    MockDate.set('2019-01-01T08:00');

    var redisStore = new RedisStore({redisImplementation: redisMock});
    var cache = new Cache({
        ttl: 59,
        stores: [redisStore]
    });

    await cache.load();

    await cache.set('foo', 'bar');

    await cache.dumpPromise;

    items = await promisify(redisStore.client.keys)('*')

    test.equals(items.length, 2);
    
    var fileContents = await promisify(redisStore.client.get)('foo')

    test.deepEquals(JSON.parse(fileContents.toString('utf8')), {"k":"foo","v":"bar","e":1546358459000});

    MockDate.reset();
});

tap.test('Test loading undefined values', async test =>  {
    var cache = new Cache({
        ttl: 59
    });

    test.ok(cache.load([{k: 'foo', v: undefined, e: Date.now() + 1000}]));
});



tap.test('Test multi / primary store with redis', async test =>  {
    MockDate.set('2019-01-01T08:00');

    var commonStore = new RedisStore({redisImplementation: redisMock, isPrimary: true});
    var singleStore = new RedisStore({redisImplementation: redisMock});
    var cache = new Cache({
        ttl: 59, stores: [commonStore]
    });

    var cache2 = new Cache({
        ttl: 59,
        stores: [singleStore, commonStore]
    });

    await cache2.set('foo', 'bar');

    await cache2.dumpPromise

    var val = await cache.get('foo');
    /* todo test when we have returnStaleWhileRefreshing false */
    /* todo test when not isprimary */
    test.equals(val, undefined);

    await cache.refreshPromises.foo

    val = await cache.get('foo');

    test.equals(val, 'bar');

    await cache.dumpPromise;

    var items = await promisify(commonStore.client.keys)('*')
    var items2 = await promisify(singleStore.client.keys)('*')

    test.deepEquals(items, items2, 'Both file stores have same files');

    MockDate.reset();
});