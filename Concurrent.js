'use strict'

let EventEmitter = require('events').EventEmitter;

/**
 * Concurrent is used to run functions or methods concurrently.
 * functions and methods can be either normal functions or async functions.
 * when running method, you must pass bound mehtod to Concurrent.Run.
 * To specify how many async functions can be run simultaneously,
 * you can pass concurrent running number when constructing Concurrent object.
 * 0 or less means run all async functions simultaneously without limit,
 * 1 means serial to run async functions, namely run 1 async function at a time.
 */
class Concurrent extends EventEmitter {
    constructor(concurrent) {
        super();
        this._runningPromise = null;
        this._status = 0; //0:pending, 1:stopped, 2:done, 3:running, 4:stopping
        this.Concurrent = concurrent;
    }

    set Concurrent(concurrent) {
        if (this._status > 2)
            throw this.Status;
        this._concurrent = Math.floor(Math.max(concurrent, 0));
    }

    get Concurrent() {
        return this._concurrent;
    }

    async Run(asyncfunctions, ...args) {
        if (this._status > 2)
            throw this.Status;

        this._runningPromise = this._run(asyncfunctions, args);
        return await this._runningPromise;
    }

    // if item in asycfunction is a method of some object
    // then it must be bind to the object before passed to Run
    // use `bind` method of Function can easily do this
    async _run(asyncfunctions, args) {
        this._status = 3;
        let isMultiFunciton = asyncfunctions instanceof Array;
        let len = isMultiFunciton ? asyncfunctions.length : args.length;
        let results = new AsyncResults(len);
        let waits = [];
        let index = 0;

        this.emit("start", {
            length: len
        });
        for (let i = 0; i < len; i++) {
            while (index < len && (waits.length < this._concurrent || this._concurrent <= 0)) {
                let asyncfun = isMultiFunciton ? asyncfunctions[index] : asyncfunctions;
                let params = isMultiFunciton ? args : [args[index]];
                let wrapper = new AsyncWrapper(asyncfun, index);
                let runEvent = {
                    index: index,
                    asyncfun: asyncfun,
                    args: params
                };
                this.emit("run", runEvent);
                let wrapperReturn = wrapper.Run(params);
                waits.push(wrapperReturn.wait);
                let runningEvent = {
                    index: index,
                    asyncfun: asyncfun,
                    args: params,
                    promise: wrapperReturn.promise
                };
                this.emit("running", runningEvent);
                index++;
            }

            let waitResult = await Promise.race(waits);
            waits = waits.filter(item => item !== waitResult.wait);

            delete waitResult.wait;
            if ("result" in waitResult) {
                results.SetSuccess(waitResult.index, waitResult.result);
                this.emit("result", waitResult);
            } else {
                results.SetError(waitResult.index, waitResult.error);
                this.emit("error", waitResult);
            }
            if (this._status == 4)
                break;
        }

        this._runningPromise = null;

        if (this._status == 4) {
            this._status = 1;
            this.emit("stop", results);
        } else {
            this._status = 2;
            this.emit("done", results);
        }
        return results;
    }

    async Stop() {
        if (this._runningPromise == null)
            throw this.Status;

        this._status = 4;
        return await this._runningPromise;
    }

    get Status() {
        switch (this._status) {
            case 0:
                return "created";
            case 1:
                return "stopped";
            case 2:
                return "done";
            case 3:
                return "running";
            case 4:
                return "stopping";
            default:
                throw "invalid status";
        }
    }

    get StatusCode() {
        return this._status;
    }
}

class AsyncWrapper {
    constructor(asyncfun, index) {
        this.asyncfun = asyncfun;
        this.index = index;
    }

    Run(args) {
        let self = this;
        let promise = null;
        try {
            promise = this.asyncfun(...args);
            //asyncfun not return Promise
            if (promise == null || typeof promise.then != "function")
                promise = Promise.resolve(promise);
        } catch (ex) {
            promise = Promise.reject(ex);
        }
        this.wait = promise.then(
            result => ({
                index: self.index,
                args: args,
                asyncfun: self.asyncfun,
                promise: promise,
                wait: self.wait,
                result: result
            }),
            error => ({
                index: self.index,
                args: args,
                asyncfun: self.asyncfun,
                promise: promise,
                wait: self.wait,
                error: error
            })
        );
        return {
            wait: this.wait,
            promise: promise
        };
    }
}

class AsyncResults extends Array {
    constructor(length) {
        super(length);
        this.SuccessIndices = [];
        this.ErrorIndices = [];
    }

    SetSuccess(index, value) {
        this.SuccessIndices.push(index);
        this.SuccessIndices.sort();
        this[index] = value;
    }

    SetError(index, value) {
        this.ErrorIndices.push(index);
        this.ErrorIndices.sort();
        this[index] = value;
    }

    get Successes() {
        let s = [];
        for (let i = 0, len = this.SuccessIndices.length; i < len; i++)
            s.push(this[this.SuccessIndices[i]]);
        return s;
    }

    get Errors() {
        let e = [];
        for (let i = 0, len = this.ErrorIndices.length; i < len; i++)
            e.push(this[this.ErrorIndices[i]]);
        return e;
    }

    get SuccessCount() {
        return this.SuccessIndices.length;
    }

    get ErrorCount() {
        return this.ErrorIndices.length;
    }

    get StopCount() {
        return this.length - this.SuccessCount - this.ErrorCount;
    }

    get AllSucceed() {
        return this.SuccessIndices.length === this.length;
    }
}

module.exports = Concurrent;
