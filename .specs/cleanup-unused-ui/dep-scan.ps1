$deps = @(
  '@hookform/resolvers','@radix-ui/react-accordion','@radix-ui/react-alert-dialog','@radix-ui/react-aspect-ratio',
  '@radix-ui/react-avatar','@radix-ui/react-checkbox','@radix-ui/react-collapsible','@radix-ui/react-context-menu',
  '@radix-ui/react-dialog','@radix-ui/react-dropdown-menu','@radix-ui/react-hover-card','@radix-ui/react-label',
  '@radix-ui/react-menubar','@radix-ui/react-navigation-menu','@radix-ui/react-popover','@radix-ui/react-progress',
  '@radix-ui/react-radio-group','@radix-ui/react-scroll-area','@radix-ui/react-select','@radix-ui/react-separator',
  '@radix-ui/react-slider','@radix-ui/react-slot','@radix-ui/react-switch','@radix-ui/react-tabs',
  '@radix-ui/react-toggle','@radix-ui/react-toggle-group','@radix-ui/react-tooltip',
  'class-variance-authority','cmdk','date-fns','embla-carousel-react','input-otp','lucide-react','next-themes',
  'react-day-picker','react-hook-form','react-resizable-panels','recharts','sonner','vaul','tw-animate-css'
)
$files = Get-ChildItem src, scripts -Recurse -Include *.tsx, *.ts, *.css -File
$joined = ($files | ForEach-Object { Get-Content -LiteralPath $_.FullName -Raw }) -join "`n"
foreach ($d in $deps) {
  $tag = if ($joined.Contains($d)) { 'KEEP  ' } else { 'REMOVE' }
  Write-Output ($tag + ' ' + $d)
}
