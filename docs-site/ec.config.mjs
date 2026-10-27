import { defineEcConfig } from '@astrojs/starlight/expressive-code';

// Code blocks are void sheets inside the reading window, with flag-orange tabs.
export default defineEcConfig({
  themes: ['github-dark-default'],
  useStarlightUiThemeColors: false,
  styleOverrides: {
    borderRadius: '0',
    borderColor: '#2B2926',
    codeBackground: '#0B0B0A',
    codeFontFamily: "'JetBrains Mono', ui-monospace, monospace",
    codeFontSize: '0.875rem',
    uiFontFamily: "'Barlow Condensed', sans-serif",
    frames: {
      editorTabBarBackground: '#171614',
      editorActiveTabBackground: '#E6561B',
      editorActiveTabForeground: '#0B0B0A',
      editorActiveTabIndicatorTopColor: 'transparent',
      editorActiveTabIndicatorBottomColor: 'transparent',
      terminalTitlebarBackground: '#171614',
      terminalTitlebarForeground: '#A8A39A',
      terminalBackground: '#0B0B0A',
      frameBoxShadowCssValue: 'none',
      inlineButtonBorder: '#E6561B',
      inlineButtonForeground: '#E6561B',
      tooltipSuccessBackground: '#E6561B',
      tooltipSuccessForeground: '#0B0B0A',
    },
  },
});
