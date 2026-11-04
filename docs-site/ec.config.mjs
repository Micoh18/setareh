import { defineEcConfig } from '@astrojs/starlight/expressive-code';

// Code is always set on the dark café surface, in both themes: one block
// style, 12 px radius, no border, tab bar with a light terracota indicator.
const code = {
  background: '#33261d',
  foreground: '#f3e9d8',
  border: '#4a382b',
  accent: '#e08a5e',
  muted: '#c9b9a3',
};

export default defineEcConfig({
  themes: ['github-dark'],
  useStarlightDarkModeSwitch: false,
  useStarlightUiThemeColors: false,
  styleOverrides: {
    borderRadius: '12px',
    borderWidth: '0px',
    codeBackground: code.background,
    codeForeground: code.foreground,
    codeFontFamily: "'Inter Variable', Inter, system-ui, sans-serif",
    codeFontSize: '0.875rem',
    codeFontWeight: '500',
    codeLineHeight: '1.5714',
    codePaddingBlock: '1rem',
    codePaddingInline: '1rem',
    uiFontFamily: "'Inter Variable', Inter, system-ui, sans-serif",
    uiFontSize: '0.875rem',
    uiFontWeight: '500',
    frames: {
      frameBoxShadowCssValue: 'none',
      editorBackground: code.background,
      terminalBackground: code.background,
      editorTabBarBackground: code.background,
      terminalTitlebarBackground: code.background,
      editorTabBarBorderBottomColor: code.border,
      terminalTitlebarBorderBottomColor: code.border,
      editorTabBarBorderColor: 'transparent',
      editorActiveTabBackground: code.background,
      editorActiveTabForeground: code.foreground,
      editorActiveTabBorderColor: 'transparent',
      editorActiveTabIndicatorTopColor: 'transparent',
      editorActiveTabIndicatorBottomColor: code.accent,
      editorActiveTabIndicatorHeight: '2px',
      terminalTitlebarForeground: code.foreground,
      terminalTitlebarDotsOpacity: '0',
      inlineButtonBackground: code.background,
      inlineButtonForeground: code.foreground,
      inlineButtonBorder: code.border,
      tooltipSuccessBackground: code.accent,
      tooltipSuccessForeground: '#1e1611',
    },
  },
});
