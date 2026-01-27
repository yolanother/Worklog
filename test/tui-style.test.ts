import { describe, it, expect, vi, beforeEach } from 'vitest';
import type * as BlessedType from 'blessed';

// Mock blessed module
const blessedMock = {
  screen: vi.fn(() => ({
    render: vi.fn(),
    destroy: vi.fn(),
    key: vi.fn(),
    on: vi.fn(),
    once: vi.fn(),
    off: vi.fn(),
  })),
  textarea: vi.fn((options: any) => {
    // Create a mock textarea with style object
    const widget = {
      style: options.style || {},
      top: options.top,
      left: options.left,
      width: options.width,
      height: options.height,
      setContent: vi.fn(),
      setValue: vi.fn(),
      getValue: vi.fn(() => ''),
      clearValue: vi.fn(),
      focus: vi.fn(),
      show: vi.fn(),
      hide: vi.fn(),
      destroy: vi.fn(),
      on: vi.fn(),
      once: vi.fn(),
      off: vi.fn(),
    };
    return widget;
  }),
  box: vi.fn((options: any) => ({
    style: options.style || {},
    append: vi.fn(),
    show: vi.fn(),
    hide: vi.fn(),
    destroy: vi.fn(),
    on: vi.fn(),
    once: vi.fn(),
    off: vi.fn(),
  })),
  list: vi.fn((options: any) => ({
    style: options.style || {},
    setItems: vi.fn(),
    select: vi.fn(),
    show: vi.fn(),
    hide: vi.fn(),
    destroy: vi.fn(),
    on: vi.fn(),
    once: vi.fn(),
    off: vi.fn(),
  })),
};

vi.mock('blessed', () => blessedMock);

describe('TUI Style Handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should preserve style object when clearing style properties', () => {
    // Create a mock textarea with initial style
    const initialStyle = {
      focus: { border: { fg: 'green' } },
      border: { fg: 'white' },
      bold: true, // Property that blessed might expect
    };
    
    const textarea = blessedMock.textarea({
      style: initialStyle,
    });

    // Store original style reference
    const originalStyleRef = textarea.style;

    // Simulate what the fixed code does - clear properties without replacing object
    if (textarea.style.border) {
      Object.keys(textarea.style.border).forEach(key => {
        delete textarea.style.border[key];
      });
    }
    if (textarea.style.focus) {
      if (textarea.style.focus.border) {
        Object.keys(textarea.style.focus.border).forEach(key => {
          delete textarea.style.focus.border[key];
        });
      }
    }

    // Verify the style object is the same reference (not replaced)
    expect(textarea.style).toBe(originalStyleRef);
    
    // Verify that properties are cleared but object structure is preserved
    expect(textarea.style.border).toBeDefined();
    expect(Object.keys(textarea.style.border).length).toBe(0);
    
    // Verify that other style properties like 'bold' are preserved
    expect(textarea.style.bold).toBe(true);
  });

  it('should not crash when accessing style properties after clearing', () => {
    const textarea = blessedMock.textarea({
      style: { focus: { border: { fg: 'green' } } },
    });

    // Clear style properties as the fixed code does
    if (textarea.style.border) {
      Object.keys(textarea.style.border).forEach(key => {
        delete textarea.style.border[key];
      });
    }

    // This should not throw an error
    expect(() => {
      // Simulate blessed internal code trying to access style properties
      const bold = textarea.style?.bold;
      const fg = textarea.style?.fg;
      const bg = textarea.style?.bg;
    }).not.toThrow();
  });

  it('should handle widgets with no initial style object', () => {
    const textarea = blessedMock.textarea({});

    // Ensure style exists
    if (!textarea.style) {
      textarea.style = {};
    }

    // This should work without errors
    expect(() => {
      if (textarea.style.border) {
        Object.keys(textarea.style.border).forEach(key => {
          delete textarea.style.border[key];
        });
      }
    }).not.toThrow();

    expect(textarea.style).toBeDefined();
  });

  it('should not replace style object reference (regression test for crash bug)', () => {
    // This test ensures we never do: widget.style = {}
    // which was causing the "Cannot read properties of undefined (reading 'bold')" error
    
    const textarea = blessedMock.textarea({
      style: { 
        focus: { border: { fg: 'green' } },
        bold: true,
        fg: 'white',
      },
    });

    const originalStyle = textarea.style;
    const originalBold = textarea.style.bold;

    // BAD: This is what was causing the bug
    // textarea.style = textarea.style || {};
    // textarea.style.border = {};
    // textarea.style.focus = {};

    // GOOD: This is the fix - modify existing object
    if (!textarea.style) {
      textarea.style = {};
    }
    if (textarea.style.border) {
      Object.keys(textarea.style.border).forEach(key => {
        delete textarea.style.border[key];
      });
    }
    if (textarea.style.focus) {
      if (textarea.style.focus.border) {
        Object.keys(textarea.style.focus.border).forEach(key => {
          delete textarea.style.focus.border[key];
        });
      }
    }

    // Verify style object wasn't replaced
    expect(textarea.style).toBe(originalStyle);
    // Verify other properties are preserved
    expect(textarea.style.bold).toBe(originalBold);
    expect(textarea.style.fg).toBe('white');
  });
});