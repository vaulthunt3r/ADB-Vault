export interface AppearanceTheme {
  id: string; name: string; description: string; mode: 'light' | 'dark'; colors: Record<string, string>
  navigationBackground?: string
  family?: 'palette' | 'chat'
}
type Surfaces = [bg: string, surface: string, alternate: string, sidebar: string, text: string, muted: string, line: string, strongLine: string, accent: string, selected: string]
function theme(id: string, name: string, description: string, mode: 'light' | 'dark', values: Surfaces): AppearanceTheme {
  const [bg, surface, alternate, sidebar, text, muted, line, strongLine, accent, selected] = values
  const dark = mode === 'dark'
  return { id, name, description, mode, colors: {
    bg, surface, 'surface-alt': alternate, sidebar, text, muted, line, 'line-strong': strongLine, accent, 'accent-soft': selected, selected,
    hover: alternate, 'on-accent': dark ? '#10151d' : '#ffffff', shadow: dark ? '#00000066' : '#18212b18', overlay: '#10182488',
    success: dark ? '#83dfad' : '#17653b', 'success-bg': dark ? '#153a29' : '#e5f5eb', 'success-line': dark ? '#2f7852' : '#add4bd',
    warning: dark ? '#ffcf78' : '#835600', 'warning-bg': dark ? '#3a2e16' : '#fff3d7', 'warning-line': dark ? '#84652d' : '#e6c879',
    error: dark ? '#ffaaa5' : '#b42332', 'error-bg': dark ? '#431f27' : '#ffebed', 'error-line': dark ? '#91505a' : '#e7adb5',
    info: dark ? '#9acbff' : '#195d9e', 'info-bg': dark ? '#18324c' : '#e9f2ff', 'info-line': dark ? '#3d6895' : '#aecdec',
    violet: dark ? '#d1b2ff' : '#7040a5', 'violet-bg': dark ? '#332347' : '#f2eaff', 'violet-line': dark ? '#72549b' : '#cfb4e7',
    neutral: muted, 'neutral-bg': alternate, 'neutral-line': line,
  } }
}
// Adapted palette colors and source notices: third-party-notices/THEME-PALETTES.txt.
// All themes expose the same color keys, so switching cannot leave stale tokens.
function palette(id: string, name: string, description: string, mode: 'light' | 'dark', family: NonNullable<AppearanceTheme['family']>, values: Surfaces, status: [success: string, warning: string, error: string, info: string, violet: string]): AppearanceTheme {
  const result = { ...theme(id, name, description, mode, values), family }
  const blend = (a: string, b: string, amount: number) => '#' + [1, 3, 5].map(offset => Math.round(parseInt(a.slice(offset, offset + 2), 16) * amount + parseInt(b.slice(offset, offset + 2), 16) * (1 - amount)).toString(16).padStart(2, '0')).join('')
  for (const [index, role] of ['success', 'warning', 'error', 'info', 'violet'].entries()) {
    result.colors[role] = status[index]
    result.colors[`${role}-bg`] = blend(status[index], mode === 'dark' ? result.colors.bg : result.colors.surface, mode === 'dark' ? .06 : .08)
    result.colors[`${role}-line`] = blend(status[index], result.colors.surface, .35)
  }
  return result
}
export const themes: AppearanceTheme[] = [
  theme('sage', 'Soft Sage', 'The original green palette with distinct status colors.', 'light', ['#f7f9f5','#ffffff','#edf2e8','#eef2e9','#26362e','#586b5d','#d8e0d1','#b5c4ae','#26735b','#e0eddf']),
  theme('vault-blue', 'Vault Blue', 'Neutral white and gray surfaces with a clear blue accent.', 'light', ['#f7f8fa','#ffffff','#f3f4f6','#f3f4f6','#202631','#626c7a','#e5e8ed','#b5bdc9','#345bd1','#edf2ff']),
  theme('git-light', 'Git Light', 'Neutral tables, blue accents and clear borders.', 'light', ['#f6f8fa','#ffffff','#f0f3f6','#eaeef2','#1f2328','#59636e','#d1d9e0','#9ba8b6','#0963ce','#ddedff']),
  theme('git-dark', 'Git Dark', 'A dark workspace with colors inspired by code changes.', 'dark', ['#0d1117','#161b22','#21262d','#10151c','#e6edf3','#a9b5c4','#303b49','#63738a','#79b8ff','#203a58']),
  theme('graphite', 'Graphite', 'Graphite surfaces with restrained backgrounds and an orange accent.', 'dark', ['#191919','#242424','#2d2d2d','#1e1e1e','#efefef','#bcbcbc','#414141','#727272','#f5b477','#4a3325']),
  theme('paper', 'Paper', 'Warm paper backgrounds and subtle brown accents.', 'light', ['#f5f0e7','#fffcf5','#ede6d8','#eae2d3','#363028','#685e51','#d5cbbb','#ad9d86','#805735','#ece0ce']),
  theme('arctic', 'Arctic', 'Cool light backgrounds with teal selection colors.', 'light', ['#f2f8fa','#ffffff','#e7f0f4','#e4edf2','#243d49','#526c79','#cadce4','#9db5c2','#086d81','#d8eef2']),
  theme('indigo', 'Indigo', 'A light interface with a distinct indigo accent.', 'light', ['#f6f6fc','#ffffff','#ececf7','#eaeaf5','#292941','#60607c','#d6d6e9','#adadc9','#5147b8','#e6e4fb']),
  theme('rose', 'Rose Quartz', 'Warm gray surfaces with a berry accent.', 'light', ['#faf6f7','#ffffff','#f4ebee','#f0e8eb','#3c2c33','#735e67','#e0cfd7','#bca4af','#a03d69','#f4dfE8']),
  theme('blueprint', 'Blueprint', 'White workspaces with clear blue dividers.', 'light', ['#edf3fa','#ffffff','#e4edf7','#dce7f3','#1b344e','#4d6780','#bdcfe2','#819ebc','#215b9d','#d5e6f8']),
  theme('nord', 'Nord', 'Blue-gray surfaces with a soft ice-blue accent.', 'dark', ['#242b36','#2e3745','#394454','#29313e','#e5ecf4','#b2c2d5','#4c5b70','#758ba3','#8fcbd3','#364f60']),
  theme('ocean', 'Deep Ocean', 'Deep blue backgrounds with teal details.', 'dark', ['#0c202b','#132d3a','#1c3a49','#102631','#dceef4','#a0c0cc','#315363','#5f8292','#72d5cb','#164c4e']),
  theme('plum', 'Midnight Plum', 'Dark purple surfaces with a lavender accent.', 'dark', ['#211b2b','#2c2539','#382f47','#261f32','#eee5f7','#c0aecf','#50415f','#806891','#c4a0ed','#4b365e']),
  theme('terminal', 'Terminal', 'An almost black background with a bright green accent.', 'dark', ['#101513','#17201b','#202d25','#131b16','#e5f1e8','#abc2b1','#354a3c','#678371','#7be3a0','#244b32']),
  theme('contrast', 'High Contrast', 'Clear light borders, white text and yellow focus indicators.', 'dark', ['#090b0e','#11151b','#202630','#0d1015','#ffffff','#d0d8e4','#8291a5','#b9c6d8','#ffe074','#454020']),
  // Optional surface treatments live in theme-variants.css and match only these IDs.
  theme('air', 'Air', 'Open white surfaces, quiet dividers and flat controls with a blue accent.', 'light', ['#ffffff','#ffffff','#f3f5f9','#ffffff','#242b39','#606b7d','#e3e7ee','#b3bdcc','#3e5eca','#edf1ff']),
  theme('soft-layers', 'Soft Layers', 'Raised white panels, soft shadows and a cool layered background.', 'light', ['#edf0f7','#ffffff','#f2f4fa','#f4f6fb','#242d3f','#5d6b80','#dce3ef','#aebbd0','#435cc4','#eaf0ff']),
  theme('technical', 'Technical', 'Dark blue-gray panels, precise separators and alternating table rows.', 'dark', ['#151e28','#1d2936','#273747','#192430','#e3edf6','#b5c7d8','#425a70','#7e97ad','#96c8f5','#294764']),
  { ...theme('accent-rail', 'Accent Rail', 'Deep blue navigation, light workspaces and strong selection accents.', 'light', ['#f2f4f9','#ffffff','#ebeff7','#ffffff','#25314a','#5a687f','#d9e0ed','#abb9d0','#3656b8','#e9efff']), navigationBackground: '#273b73' },
  palette('gruvbox-dark', 'Gruvbox Dark', 'Warm charcoal, retro amber, cream text and earthy status colors.', 'dark', 'palette', ['#282828','#32302f','#3c3836','#1d2021','#ebdbb2','#bdae93','#504945','#928374','#fabd2f','#473b26'], ['#b8bb26','#fabd2f','#ff8370','#83a598','#d3869b']),
  palette('gruvbox-light', 'Gruvbox Light', 'Warm parchment, burnt orange and the familiar earthy Gruvbox palette.', 'light', 'palette', ['#fbf1c7','#f9f5d7','#ebdbb2','#f2e5bc','#3c3836','#665c54','#d5c4a1','#a89984','#af3a03','#f2dfb0'], ['#626509','#865614','#9d0006','#076678','#8f3f71']),
  palette('catppuccin-mocha', 'Catppuccin Mocha', 'Pastel mauve, a dark cocoa-blue base and colorful, soft status accents.', 'dark', 'palette', ['#1e1e2e','#242436','#313244','#181825','#cdd6f4','#a6adc8','#45475a','#7f849c','#cba6f7','#39304c'], ['#a6e3a1','#f9e2af','#f38ba8','#89b4fa','#cba6f7']),
  palette('catppuccin-latte', 'Catppuccin Latte', 'Milky gray surfaces, rich mauve and a bright daytime pastel palette.', 'light', 'palette', ['#eff1f5','#f8f9fc','#e6e9ef','#dce0e8','#4c4f69','#5c5f77','#bcc0cc','#8c8fa1','#8839ef','#f0e8fc'], ['#327a21','#8b570d','#d20f39','#1956d0','#8839ef']),
  palette('everforest-dark', 'Everforest Dark', 'Forest-gray surfaces, warm ivory text and moss-green accents.', 'dark', 'palette', ['#2d353b','#343f44','#3d484d','#232a2e','#d3c6aa','#b5beb0','#4f585e','#859289','#a7c080','#3c4841'], ['#a7c080','#dbbc7f','#ed9698','#8ac8bf','#d699b6']),
  palette('everforest-light', 'Everforest Light', 'Soft cream, sage-green panels and earthy forest colors in daylight.', 'light', 'palette', ['#fdf6e3','#fffbef','#f4f0d9','#efebd4','#4e5b55','#59665e','#d5dbc3','#939f91','#496d27','#e7edcf'], ['#496d27','#85601c','#b83244','#286b72','#885b89']),
  palette('nord-polar', 'Nord Polar', 'Polar Night surfaces, Snow Storm text and Frost accents from the Nord palette.', 'dark', 'palette', ['#2e3440','#3b4252','#434c5e','#2e3440','#eceff4','#d8dee9','#4c566a','#8b95aa','#88c0d0','#384957'], ['#a3be8c','#ebcb8b','#e59ca3','#88c0d0','#cfafd0']),
  palette('github-dimmed', 'GitHub Dimmed', 'Quiet code-workspace grays, blue links, crisp borders and green primary actions.', 'dark', 'palette', ['#22272e','#2d333b','#373e47','#1c2128','#e6edf3','#b1bac4','#444c56','#768390','#8ec5ff','#263d56'], ['#8cdb9b','#eac55f','#ffaaa8','#8ec5ff','#dcbdfb']),
  palette('blurple', 'Blurple', 'A chat-inspired charcoal workspace with violet-blue navigation and bright accents.', 'dark', 'chat', ['#25262c','#303138','#383943','#202127','#f2f3f7','#bcc0ce','#484b59','#81869d','#b9baff','#3c3e61'], ['#8dd8b5','#f1cf8d','#ffacb6','#9bc9fa','#cec0ff']),
]
export const findTheme = (id: unknown) => themes.find(theme => theme.id === id)
  ?? (['glass-light', 'glass-dark', 'material-light', 'material-dark'].includes(String(id)) ? themes.find(theme => theme.id === 'air')! : themes[0])
// The title-bar easter egg is an overlay; the selected gallery theme is retained.
export const terminalModeName = 'Zero Cool'
export const terminalEasterEggTheme = theme('terminal-easter-egg', terminalModeName, 'Green text on black. Right-click the terminal icon to pin across restarts. Double-click it to restore your theme.', 'dark', ['#000000','#000000','#000000','#000000','#7dff99','#79b887','#163d21','#367f47','#57ff7b','#082612'])
for (const role of ['success', 'info', 'violet', 'neutral']) {
  terminalEasterEggTheme.colors[role] = role === 'neutral' ? '#79b887' : '#7dff99'
  terminalEasterEggTheme.colors[`${role}-bg`] = '#000000'
  terminalEasterEggTheme.colors[`${role}-line`] = '#367f47'
}
Object.assign(terminalEasterEggTheme.colors, { hover: '#061b0d', 'warning-bg': '#000000', 'error-bg': '#000000', shadow: '#00000000', 'on-accent': '#000000' })
export type TerminalColor = 'green' | 'amber'
export const terminalAmberTheme = theme('terminal-easter-egg-amber', 'Zero Cool Amber', 'Warm orange phosphor on black. Right-click the terminal icon to pin across restarts. Double-click it to restore your theme.', 'dark', ['#000000','#000000','#000000','#000000','#ffb65c','#bd905a','#472a0f','#9c6128','#ffa12d','#321c05'])
for (const role of ['success', 'info', 'violet', 'neutral']) {
  terminalAmberTheme.colors[role] = role === 'neutral' ? '#bd905a' : '#ffb65c'
  terminalAmberTheme.colors[`${role}-bg`] = '#000000'
  terminalAmberTheme.colors[`${role}-line`] = '#9c6128'
}
Object.assign(terminalAmberTheme.colors, { hover: '#1b1004', warning: '#ffe0a3', 'warning-bg': '#000000', 'error-bg': '#000000', shadow: '#00000000', 'on-accent': '#000000' })
export const terminalThemes = [terminalEasterEggTheme, terminalAmberTheme]
export const getTerminalTheme = (color: TerminalColor) => color === 'amber' ? terminalAmberTheme : terminalEasterEggTheme
export const getActiveTheme = (id: unknown, terminalMode: boolean, color: TerminalColor = 'green') => terminalMode ? getTerminalTheme(color) : findTheme(id)
export function applyZenMode(enabled: boolean) {
  document.documentElement.dataset.zenMode = String(enabled)
}
export function applyCornerStyle(style: 'rounded' | 'square') {
  document.documentElement.dataset.cornerStyle = style
}
export function applyTheme(theme: AppearanceTheme) {
  const root = document.documentElement
  root.dataset.theme = theme.id
  root.dataset.themeFamily = theme.family ?? 'classic'
  root.dataset.terminalMode = String(terminalThemes.some(terminal => terminal.id === theme.id))
  root.dataset.colorMode = theme.mode
  root.style.colorScheme = theme.mode
  for (const [name, value] of Object.entries(theme.colors)) root.style.setProperty(`--${name}`, value)
}
