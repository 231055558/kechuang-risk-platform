import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

import { createServer } from "vite"

const testDirectory = dirname(fileURLToPath(import.meta.url))
const projectRoot = join(testDirectory, "..")

function readProjectFile(path: string) {
  return readFileSync(join(projectRoot, path), "utf8")
}

function setGlobal(name: string, value: unknown) {
  const original = Object.getOwnPropertyDescriptor(globalThis, name)

  Object.defineProperty(globalThis, name, {
    configurable: true,
    value,
  })

  return () => {
    if (original) {
      Object.defineProperty(globalThis, name, original)
    } else {
      Reflect.deleteProperty(globalThis, name)
    }
  }
}

test("reduced motion and reveal observation share browser subscriptions", async () => {
  const server = await createServer({
    configFile: false,
    root: projectRoot,
    resolve: {
      alias: {
        "@": join(projectRoot, "src"),
      },
    },
    optimizeDeps: {
      noDiscovery: true,
    },
    server: { middlewareMode: true },
    appType: "custom",
    logLevel: "silent",
  })

  try {
    const motionModule = await server.ssrLoadModule(
      "/src/components/motion/workflow-transition.tsx"
    )
    const liquidModule = await server.ssrLoadModule(
      "/src/components/liquid/liquid-glass-surface.tsx"
    )

    let reducedMotion = false
    let matchMediaCalls = 0
    let mediaListenerAdds = 0
    let mediaListenerRemoves = 0
    let userAgentReads = 0
    let cssSupportCalls = 0
    let svgCapabilityReads = 0
    let mediaChangeListener: (() => void) | undefined
    let observerCallback: IntersectionObserverCallback | undefined
    const observedElements = new Set<Element>()
    const unobservedElements: Element[] = []
    let observerConstructions = 0

    const mediaQuery = {
      get matches() {
        return reducedMotion
      },
      media: "(prefers-reduced-motion: reduce)",
      onchange: null,
      addEventListener(type: string, listener: () => void) {
        assert.equal(type, "change")
        mediaListenerAdds += 1
        mediaChangeListener = listener
      },
      removeEventListener(type: string, listener: () => void) {
        assert.equal(type, "change")
        assert.equal(listener, mediaChangeListener)
        mediaListenerRemoves += 1
        mediaChangeListener = undefined
      },
      addListener() {
        assert.fail("modern media query listeners should be used")
      },
      removeListener() {
        assert.fail("modern media query listeners should be used")
      },
      dispatchEvent() {
        return true
      },
    }

    class FakeIntersectionObserver {
      readonly root = null
      readonly rootMargin = "0px 0px -8% 0px"
      readonly thresholds = [0.06]

      constructor(callback: IntersectionObserverCallback) {
        observerConstructions += 1
        observerCallback = callback
      }

      observe(target: Element) {
        observedElements.add(target)
      }

      unobserve(target: Element) {
        observedElements.delete(target)
        unobservedElements.push(target)
      }

      disconnect() {
        observedElements.clear()
      }

      takeRecords() {
        return []
      }
    }

    const fakeWindow = {
      matchMedia(query: string) {
        assert.equal(query, "(prefers-reduced-motion: reduce)")
        matchMediaCalls += 1
        return mediaQuery
      },
      IntersectionObserver: FakeIntersectionObserver,
    }
    const fakeNavigator = {
      get userAgent() {
        userAgentReads += 1
        return "Mozilla/5.0 Chrome/140.0.0.0 Safari/537.36"
      },
    }
    const fakeCss = {
      supports(property: string, value: string) {
        assert.equal(property, "backdrop-filter")
        assert.equal(value, "blur(1px)")
        cssSupportCalls += 1
        return true
      },
    }
    const restoreGlobals = [
      setGlobal("window", fakeWindow),
      setGlobal("navigator", fakeNavigator),
      setGlobal("CSS", fakeCss),
      setGlobal("SVGFEColorMatrixElement", class {}),
      setGlobal("SVGFEDisplacementMapElement", class {}),
    ]

    const svgColorDescriptor = Object.getOwnPropertyDescriptor(
      globalThis,
      "SVGFEColorMatrixElement"
    )
    const svgDisplacementDescriptor = Object.getOwnPropertyDescriptor(
      globalThis,
      "SVGFEDisplacementMapElement"
    )
    Object.defineProperty(globalThis, "SVGFEColorMatrixElement", {
      configurable: true,
      get() {
        svgCapabilityReads += 1
        return svgColorDescriptor?.value
      },
    })
    Object.defineProperty(globalThis, "SVGFEDisplacementMapElement", {
      configurable: true,
      get() {
        svgCapabilityReads += 1
        return svgDisplacementDescriptor?.value
      },
    })

    try {
      const store = motionModule.reducedMotionPreferenceStore as {
        getSnapshot: () => boolean
        subscribe: (listener: () => void) => () => void
      }
      let firstNotifications = 0
      let secondNotifications = 0
      const unsubscribeFirst = store.subscribe(() => {
        firstNotifications += 1
      })
      const unsubscribeSecond = store.subscribe(() => {
        secondNotifications += 1
      })

      assert.equal(matchMediaCalls, 1)
      assert.equal(mediaListenerAdds, 1)
      assert.equal(store.getSnapshot(), false)
      assert.equal(liquidModule.getLiquidGlassFallback(), false)
      assert.equal(liquidModule.getLiquidGlassFallback(), false)
      assert.equal(userAgentReads, 1)
      assert.equal(cssSupportCalls, 1)
      assert.equal(svgCapabilityReads, 2)

      reducedMotion = true
      mediaChangeListener?.()

      assert.equal(firstNotifications, 1)
      assert.equal(secondNotifications, 1)
      assert.equal(store.getSnapshot(), true)
      assert.equal(liquidModule.getLiquidGlassFallback(), true)
      assert.equal(userAgentReads, 1)
      assert.equal(cssSupportCalls, 1)
      assert.equal(svgCapabilityReads, 2)

      unsubscribeFirst()
      assert.equal(mediaListenerRemoves, 0)
      unsubscribeSecond()
      assert.equal(mediaListenerRemoves, 1)

      const firstElement = {} as Element
      const secondElement = {} as Element
      let firstReveals = 0
      let secondReveals = 0
      const stopFirst = motionModule.observeRevealElement(firstElement, () => {
        firstReveals += 1
      })
      const stopSecond = motionModule.observeRevealElement(
        secondElement,
        () => {
          secondReveals += 1
        }
      )

      assert.equal(observerConstructions, 1)
      assert.deepEqual(observedElements, new Set([firstElement, secondElement]))

      const observer = {
        unobserve(target: Element) {
          observedElements.delete(target)
          unobservedElements.push(target)
        },
      } as IntersectionObserver
      observerCallback?.(
        [
          { isIntersecting: true, target: firstElement },
          { isIntersecting: false, target: secondElement },
        ] as IntersectionObserverEntry[],
        observer
      )

      assert.equal(firstReveals, 1)
      assert.equal(secondReveals, 0)
      assert.equal(observedElements.has(firstElement), false)
      assert.equal(observedElements.has(secondElement), true)

      stopFirst()
      stopSecond()
      assert.equal(observedElements.size, 0)
      assert.deepEqual(unobservedElements, [firstElement, secondElement])
    } finally {
      restoreGlobals.reverse().forEach((restore) => restore())
    }
  } finally {
    await server.close()
  }
})

test("Reveal and LiquidGlassSurface consume the live reduced-motion store", () => {
  const workflowSource = readProjectFile(
    "src/components/motion/workflow-transition.tsx"
  )
  const liquidSource = readProjectFile(
    "src/components/liquid/liquid-glass-surface.tsx"
  )

  assert.match(
    workflowSource,
    /const prefersReducedMotion = usePrefersReducedMotion\(\)/
  )
  assert.match(
    workflowSource,
    /prefersReducedMotion \|\| !supportsIntersectionObserver \|\| hasRevealed/
  )
  assert.match(
    workflowSource,
    /useState\(\s*\(\) => prefersReducedMotion \|\| !supportsIntersectionObserver\s*\)/
  )
  assert.match(
    workflowSource,
    /useSyncExternalStore\(\s*reducedMotionPreferenceStore\.subscribe,\s*reducedMotionPreferenceStore\.getSnapshot/
  )
  assert.match(
    workflowSource,
    /if \(!prefersReducedMotion\) \{\s*return undefined\s*\}[\s\S]*requestAnimationFrame\(\(\) => \{\s*setHasRevealed\(true\)\s*\}\)[\s\S]*cancelAnimationFrame\(frameId\)/
  )
  assert.match(
    workflowSource,
    /return observeRevealElement\(element, \(\) => setHasRevealed\(true\)\)/
  )
  assert.match(
    liquidSource,
    /const prefersReducedMotion = usePrefersReducedMotion\(\)/
  )
  assert.match(
    liquidSource,
    /asFallback \|\| prefersReducedMotion \|\| getStaticLiquidGlassFallback\(\)/
  )
  assert.match(liquidSource, /useEffect\(\(\) => \{[\s\S]*shouldTrackPointer/)
})

test("lazy workflow fallback uses translucent glass surfaces instead of solid blocks", () => {
  const appSource = readProjectFile("src/App.tsx")
  const businessStyles = readProjectFile("src/styles/business.css")

  assert.match(appSource, /className="tab-skeleton-panel"/)
  assert.match(appSource, /className="tab-skeleton-list"/)
  assert.match(appSource, /className="tab-skeleton-row"/)
  assert.match(
    businessStyles,
    /\.tab-skeleton-panel,[\s\S]*\.tab-skeleton-list \{[\s\S]*backdrop-filter: blur\(22px\) saturate\(1\.18\)/
  )
  assert.match(businessStyles, /var\(--glass-panel-shadow\)/)
  assert.match(businessStyles, /@keyframes skeleton-sheen/)
  assert.doesNotMatch(
    businessStyles,
    /\.tab-skeleton-block \{[\s\S]*height: 150px/
  )
})
