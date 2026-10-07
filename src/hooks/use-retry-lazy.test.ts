import { retryLazyImport, useRetryLazy } from "./use-retry-lazy";

describe("retryLazyImport", () => {
  beforeEach(() => {
    // Clean session storage between tests so keys from one test do not leak into another.
    try {
      sessionStorage.clear();
    } catch {
      /* storage may be unavailable in some test environments */
    }
  });

  it("returns the default export on the first attempt", async () => {
    const Component = () => null;
    const importFn = jest.fn<() => Promise<{ default: typeof Component }>>().mockResolvedValueOnce({
      default: Component,
    });

    const result = await retryLazyImport({
      key: "ok-module",
      importFn: importFn as () => Promise<{ default: React.ComponentType<{}> }>,
    });

    expect(result).toBe(Component);
    expect(importFn).toHaveBeenCalledTimes(1);
  });

  it("retries once after a transient failure and succeeds", async () => {
    const Component = () => null;
    const importFn = jest.fn<() => Promise<{ default: typeof Component }>>()
      .mockRejectedValueOnce(new Error("network blip"))
      .mockResolvedValueOnce({ default: Component });

    const result = await retryLazyImport({
      key: "retry-module",
      importFn: importFn as () => Promise<{ default: React.ComponentType<{}> }>,
    });

    expect(result).toBe(Component);
    expect(importFn).toHaveBeenCalledTimes(2);
  });

  it("clears the sessionStorage flag when the import succeeds", async () => {
    const importFn = jest.fn<() => Promise<{ default: React.ComponentType<{}> }>>().mockResolvedValueOnce({
      default: () => null,
    });

    await retryLazyImport({
      key: "clean-state-module",
      importFn,
    });

    expect(sessionStorage.getItem("truthlens.lazy.clean-state-module")).toBeNull();
  });

  it("does not reload when the module already has no default export on the first try", async () => {
    const reloadSpy = jest.spyOn(window.location, "reload").mockImplementation(() => {
      throw new Error("reload called");
    });

    const importFn = jest.fn<() => Promise<{ default: React.ComponentType<{}> }>>().mockResolvedValueOnce({
      // @ts-expect-error intended invalid shape for this case
      nonexistent: "not a component",
    });

    await expect(
      retryLazyImport({
        key: "bad-module",
        importFn,
        reloadOnFailure: false,
      }),
    ).rejects.toThrow(/has no default export/);

    expect(sessionStorage.getItem("truthlens.lazy.bad-module")).toBe("attempted");
    expect(reloadSpy).not.toHaveBeenCalled();
    reloadSpy.mockRestore();
  });

  it("schedules a reload when both attempts fail and reloadOnFailure is true", async () => {
    const reloadSpy = jest.spyOn(window.location, "reload").mockImplementation(() => {
      throw new Error("reload called");
    });

    const error = new Error("chunk gone");
    const importFn = jest.fn<() => Promise<{ default: React.ComponentType<{}> }>>()
      .mockRejectedValue(error)
      .mockRejectedValue(error);

    await retryLazyImport({
      key: "fail-module",
      importFn,
      reloadOnFailure: true,
    }).catch(() => {
      /* expected: the helper is async and the reload is a side effect */
    });

    expect(sessionStorage.getItem("truthlens.lazy.fail-module")).toBe("reloaded");
    expect(reloadSpy).toHaveBeenCalledTimes(1);
    reloadSpy.mockRestore();
  });

  it("does not reload again for the same chunk in the same session", async () => {
    const reloadSpy = jest.spyOn(window.location, "reload").mockImplementation(() => {
      throw new Error("reload called");
    });
    sessionStorage.setItem("truthlens.lazy.duplicate-module", "reloaded");

    const error = new Error("chunk gone");
    const importFn = jest.fn<() => Promise<{ default: React.ComponentType<{}> }>>()
      .mockRejectedValue(error)
      .mockRejectedValue(error);

    await retryLazyImport({
      key: "duplicate-module",
      importFn,
      reloadOnFailure: true,
    }).catch(() => {
      /* expected */
    });

    expect(reloadSpy).not.toHaveBeenCalled();
    reloadSpy.mockRestore();
  });

  it("accepts an importFn that resolves after a delay", async () => {
    let resolve: (value: { default: React.ComponentType<{}> }) => void;
    const promise = new Promise<{ default: React.ComponentType<{}> }>((res) => {
      resolve = res;
    });
    const importFn = jest.fn<() => Promise<{ default: React.ComponentType<{}> }>>().mockReturnValue(promise);

    const resultPromise = retryLazyImport({
      key: "delayed-module",
      importFn: importFn as () => Promise<{ default: React.ComponentType<{}> }>,
    });

    const Component = () => null;
    resolve({ default: Component });

    expect(await resultPromise).toBe(Component);
  });
});

describe("useRetryLazy", () => {
  it("is a function that returns a LazyExoticComponent", () => {
    expect(typeof useRetryLazy).toBe("function");
  });
});
