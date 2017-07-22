const Chrome = require('./chrome')
const debug = require('debug')('chrome')
const jsesc = require('jsesc')
const { Flow } = require('myflow')
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

class Automator extends Flow {
  constructor (opts = {}) {
    super()
    let flags = {
      port: opts.port || 9222
    }
    if (opts.show === false) {
      (flags.chromeFlags || (flags.chromeFlags = [])).push('--headless')
    }
    Chrome(flags)
    .then((chrome) => {
      this.chrome = chrome
      this.run()
    })
    .catch(function (e) {
      console.log(e)
    })
  }

  goto (url) {
    return this.pipe(function () {
      return this.chrome.Page.navigate({ url })
    })
  }

  waitfn (fn, ...args) {
    var timeout = 10000
    var self = this
    return new Promise(async function (resolve) {
      const startTime = Date.now()
      while (Date.now() - startTime < timeout) {
        await sleep(500)
        var ret = await self.evaluate_now(fn, ...args)
        if (ret !== false) {
          break
        }
      }
      resolve()
    })
  }

  waitSelector (selector) {
    return this.waitfn(function (selector) {
      return !!window.top.currentWindow.document.querySelector(selector)
    }, selector)
  }

  wait (arg, timeout = 30000) {
    return this.pipe(function () {
      if (typeof arg === 'number') {
        debug('.wait() ' + arg + 'msec')
        return sleep(arg)
      } else if (typeof arg === 'string') {
        debug('.wait() for ' + arg + ' element' + (timeout ? ' or ' + timeout + 'msec' : ''))
        return this.waitSelector(arg)
      } else if (typeof arg === 'function') {
        debug('.wait() for ' + arg + ' function ' + (timeout ? ' or ' + timeout + 'msec' : ''))
        return this.waitfn(arg)
      }
    })
  }

  iframe (selector) {
    return this.pipe(function () {
      return this.evaluate_now(async function (selector) {
        try {
          window.top.iframeStacks.push(window.top.currentWindow.document.querySelector(selector))
          window.top.windowStacks.push(window.top.iframeStacks[window.top.iframeStacks.length - 1].contentWindow)
        } catch (e) {
          console.info('goto iframe error')
        }
      }, selector)
    })
  }

  parent () {
    return this.pipe(function () {
      return this.evaluate_now(async function (selector) {
        if (window.top.windowStacks.length > 1) {
          window.top.iframeStacks.pop()
          window.top.windowStacks.pop()
        }
      })
    })
  }

  evaluate_now (fn, ...args) { // eslint-disable-line
    // console.log(`Promise.resolve((${fn.toString()})(${args.map((arg) => JSON.stringify(jsesc(arg))).join()}))`)
    return this.chrome.Runtime.evaluate({
      expression: `
      window.top.currentWindow = (top.windowStacks || (top.windowStacks = [window]))[top.windowStacks.length - 1];
      window.top.iframeStacks = window.top.iframeStacks || []
      Promise.resolve((${fn.toString()})(${args.map((arg) => JSON.stringify(jsesc(arg))).join()}))`,
      awaitPromise: true
    })
    .then(ret => ((ret || {}).result).value)
  }

  visible (selector) {
    return this.pipe(async function (selector) {
      debug('.visible() for ' + selector)
      return this.evaluate_now(function (selector) {
        var elem = window.top.currentWindow.document.querySelector(selector)
        if (elem) return (elem.offsetWidth > 0 && elem.offsetHeight > 0)
        else return false
      }, selector)
    })
  }

  scrollTo (x, y) {
    return this.pipe(async function () {
      debug('.scrollTo()')
      return this.evaluate_now(function (y, x) {
        window.scrollTo(x, y)
      })
    })
  }

  exists (selector) {
    return this.pipe(async function () {
      debug('.exists() for ' + selector)
      return this.evaluate_now(function (selector) {
        return (window.top.currentWindow.document.querySelector(selector) !== null)
      }, selector)
    })
  }

  focusSelector (selector) {
    return this.evaluate_now(function (selector) {
      window.top.currentWindow.document.querySelector(selector).focus()
    }, selector)
  }

  blurSelector (selector) {
    return this.evaluate_now(function (selector) {
      // it is possible the element has been removed from the DOM
      // between the action and the call to blur the element
      var element = window.top.currentWindow.document.querySelector(selector)
      if (element) {
        element.blur()
      }
    }, selector)
  }

  async findPositionInWindow (obj) {
    return (await this.evaluate_now(async function (obj, sleep) {
      if (typeof obj === 'string') {
        var expression = obj
        obj = window.top.currentWindow.document.querySelector(expression)
        if (!obj) {
          throw new Error('cannot find an object using expression ' + expression)
        }
      }
      obj.scrollIntoViewIfNeeded()
      let rect = obj.getBoundingClientRect()
      let offsetLeft = 0
      let offsetTop = 0
      for (let w, i = 0; w = window.top.iframeStacks[i++];) { // eslint-disable-line
        let r = w.getBoundingClientRect()
        offsetLeft += r.left
        offsetTop += r.top
      }
      return [ rect.left + rect.width / 2 + offsetLeft, rect.top + rect.height / 2 + offsetTop ].join()
    }, obj, sleep)) || '-1,-1'
  }

  _touch (client, x, y) {
    const options = {
      touchPoints: [{
        x: x,
        y: y,
        state: 'touchPressed'
      }]
    }

    options.type = 'touchStart'
    client.Input.dispatchTouchEvent(options)

    options.touchPoints[0].state = 'touchReleased'
    options.type = 'touchEnd'
    client.Input.dispatchTouchEvent(options)
  }

  _click (client, x, y) {
    const options = {
      x: x,
      y: y,
      button: 'left',
      clickCount: 1
    }

    options.type = 'mousePressed'
    client.Input.dispatchMouseEvent(options)

    options.type = 'mouseReleased'
    client.Input.dispatchMouseEvent(options)
  }

  async sendKey (char) {
    await this.chrome.Input.dispatchKeyEvent({
      'modifiers': 0,
      'nativeVirtualKeyCode': 55,
      'text': '',
      'type': 'rawKeyDown',
      'unmodifiedText': '',
      'windowsVirtualKeyCode': 55
    })
    await this.chrome.Input.dispatchKeyEvent({
      'modifiers': 0,
      'nativeVirtualKeyCode': 0,
      'text': char,
      'type': 'char',
      'unmodifiedText': char,
      'isKeypad': true,
      'windowsVirtualKeyCode': 0
    })
    await this.chrome.Input.dispatchKeyEvent({
      'modifiers': 0,
      'nativeVirtualKeyCode': 55,
      'text': '',
      'type': 'keyUp',
      'unmodifiedText': '',
      'windowsVirtualKeyCode': 55
    })
  }

  type (selector, text) {
    return this.pipe(async function () {
      debug('.type() %s into %s', text, selector)
      await this.waitSelector(selector)
      await this.clickSelector(selector)
      if ((text || '') === '') {
        await this.evaluate_now(async function (selector) {
          window.top.currentWindow.document.querySelector(selector).value = ''
        }, selector)
      } else {
        await this.evaluate_now(async function (selector, text) {
          window.top.currentWindow.document.querySelector(selector).value = text
        }, selector, text)
      }
      await this.blurSelector(selector)
    })
  }

  insert (selector, string) {
    return this.pipe(async function () {
      if (string == null) {
        string = selector
      } else if (selector != null) {
        await this.waitSelector(selector)
        await this.clickSelector(selector)
      }

      if (string == null) {
        return
      }
      for (let i of string) {
        await this.sendKey(i)
      }
    })
  }

  async clickSelector (selector) {
    let [ left, top ] = (await this.findPositionInWindow(selector)).split(',').map(i => parseInt(i, 10))
    debug(`left: ${left}, top: ${top}`)
    this._click(this.chrome, left, top)
  }

  mousedown (selector) {
    return this.pipe(function () {
      debug('.mousedown() on ' + selector)
      return this.evaluate_now(async function (selector) {
        var element = window.top.currentWindow.document.querySelector(selector)
        if (!element) {
          throw new Error('Unable to find element by selector: ' + selector)
        }
        var event = window.top.currentWindow.document.createEvent('MouseEvent')
        event.initEvent('mousedown', true, true)
        element.dispatchEvent(event)
      }, selector)
    })
  }

  mouseup (selector) {
    return this.pipe(function () {
      debug('.mouseup() on ' + selector)
      return this.evaluate_now(async function (selector) {
        var element = window.top.currentWindow.document.querySelector(selector)
        if (!element) {
          throw new Error('Unable to find element by selector: ' + selector)
        }
        var event = window.top.currentWindow.document.createEvent('MouseEvent')
        event.initEvent('mouseup', true, true)
        element.dispatchEvent(event)
      }, selector)
    })
  }

  mouseover (selector) {
    return this.pipe(function () {
      debug('.mouseover() on ' + selector)
      return this.evaluate_now(async function (selector) {
        var element = window.top.currentWindow.document.querySelector(selector)
        if (!element) {
          throw new Error('Unable to find element by selector: ' + selector)
        }
        var event = window.top.currentWindow.document.createEvent('MouseEvent')
        event.initMouseEvent('mouseover', true, true)
        element.dispatchEvent(event)
      }, selector)
    })
  }

  check (selector) {
    return this.pipe(function () {
      debug('.check() ' + selector)
      return this.evaluate_now(async function (selector) {
        var element = window.top.currentWindow.document.querySelector(selector)
        var event = window.top.currentWindow.document.createEvent('HTMLEvents')
        element.checked = true
        event.initEvent('change', true, true)
        element.dispatchEvent(event)
      }, selector)
    })
  }

  uncheck (selector) {
    return this.pipe(function () {
      debug('.uncheck() ' + selector)
      return this.evaluate_now(async function (selector) {
        var element = window.top.currentWindow.document.querySelector(selector)
        var event = window.top.currentWindow.document.createEvent('HTMLEvents')
        element.checked = null
        event.initEvent('change', true, true)
        element.dispatchEvent(event)
      }, selector)
    })
  }

  select (selector, option) {
    return this.pipe(function () {
      debug('.select() ' + selector)
      return this.evaluate_now(async function (selector, option) {
        var element = window.top.currentWindow.document.querySelector(selector)
        var event = window.top.currentWindow.document.createEvent('HTMLEvents')
        element.value = option
        event.initEvent('change', true, true)
        element.dispatchEvent(event)
      }, selector, option)
    })
  }

  back () {
    return this.pipe(function () {
      debug('.back()')
      return this.evaluate_now(async function () {
        window.top.currentWindow.history.back()
      })
    })
  }

  forward () {
    return this.pipe(function () {
      debug('.forward()')
      return this.evaluate_now(async function () {
        window.top.currentWindow.history.forward()
      })
    })
  }

  refresh () {
    return this.pipe(function () {
      debug('.refresh()')
      return this.evaluate_now(async function () {
        window.top.currentWindow.location.reload()
      })
    })
  }

  url () {
    return this.pipe(async function () {
      return this.evaluate_now(async function () {
        return window.location.href
      })
    })
  }

  title () {
    return this.pipe(async function () {
      return this.evaluate_now(async function () {
        return window.top.currentWindow.document.title
      })
    })
  }

  end () {
    return this.pipe(async function (ret) {
      this.chrome.kill()
      return ret
    })
  }

  evaluate (fn, ...args) {
    return this.pipe(async function () {
      return this.evaluate_now(fn, ...args)
    })
  }

  click (selector) {
    return this.pipe(async function () {
      debug('.click() ' + selector)
      await this.waitSelector(selector)
      return this.clickSelector(selector)
    })
  }

  then (fn) {
    return this.pipe(function () {
      let result = fn.apply(this, arguments)
      if (result != null && result.then && result instanceof Automator) {
        return new Promise(resolve => result.then(resolve))
      } else {
        return result
      }
    })
  }

  catch () {
    console.log('Please use try catch to catch error!!!')
  }

  pdf (fn) {
    return this.pipe(function () {
      console.log('WARN: Not implement yet')
    })
  }

  path () {
    return this.pipe(async function () {
      return this.evaluate_now(function () {
        return window.location.pathname
      })
    })
  }
}

function $ (opts) {
  if (!(this.constructor instanceof Automator)) {
    return new Automator(opts)
  } else {
    return this
  }
}

$.action = function (name, fn, ...args) {
  if (name in Automator) {
    throw new Error(`${name} has defined`)
  }
  Automator.prototype[name] = function () {
    return this.pipe(function () {
      return fn.call(this, ...args)
    })
  }
}

module.exports = $
