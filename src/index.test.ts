jest.mock('./NativeOpenAIRealtimeToolkit')

import { getDocumentsPath, writeFile } from './index'
import NativeOpenAIRealtimeToolkit from './NativeOpenAIRealtimeToolkit'

const native = NativeOpenAIRealtimeToolkit as unknown as {
  getDocumentsPath: jest.Mock<string, []>
  writeFile: jest.Mock<boolean, [string, string]>
}

// Smoke test for the real functions the barrel exposes (the rest are
// type/re-exports). They're thin passthroughs to native, so we only verify the
// delegation — a rename on either side would surface here.

describe('filesystem passthroughs', () => {
  it('getDocumentsPath delegates to the native module', () => {
    native.getDocumentsPath.mockReturnValue('/docs')
    expect(getDocumentsPath()).toBe('/docs')
    expect(native.getDocumentsPath).toHaveBeenCalled()
  })

  it('writeFile delegates to the native module', () => {
    native.writeFile.mockReturnValue(true)
    expect(writeFile('/docs/log.txt', 'hello')).toBe(true)
    expect(native.writeFile).toHaveBeenCalledWith('/docs/log.txt', 'hello')
  })
})
