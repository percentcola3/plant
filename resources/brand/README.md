# Plant 品牌资源

正式采用「纤细弯茎 P」方案（`plant-p-natural`）：中空叶片、轻微弯曲的茎、向左上翘的小尾钩。主色为森林绿 `#20764F`，标准底色为白色。

产品定位：**让想法生长为界面。Plant 是面向设计师与产品经理的 AI UI 设计工具。**

## 唯一矢量源

`plant-mark.svg` 是透明底品牌源文件。保持叶片、茎、尾钩的比例，不拉伸、不旋转；圆角白底仅用于应用图标承载，不改变主体轮廓。

界面使用 `PlantLogo.vue`，在深浅主题中均以白底森林绿显示。单独使用透明标识时，应置于浅色背景。

## 更新与导出

在 macOS 上安装 librsvg 与 ImageMagick（`brew install librsvg imagemagick`），修改矢量源后，从项目根目录运行：

```sh
npm run brand:icons
```

脚本生成以下资源：

- `build/icon-source.svg`、`build/icon.png`：圆角白底应用及运行时 Dock 图标。
- `build/icon.iconset`、`build/icon.icns`：macOS 图标，包含 Retina 尺寸。
- `build/icon.ico`：16 至 256 像素多尺寸 ICO。
- `src/renderer/src/assets/brand/plant-icon.svg`：界面白底 Logo。
- `src/renderer/public/favicon.svg`：页面图标。

桌面应用沿用已有的打包及 Dock 路径。已安装的应用需重新打包安装才能更新 bundle 图标；运行中的开发应用重启后更新 Dock。
