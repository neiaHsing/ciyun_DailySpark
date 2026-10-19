# DailySpark · 想法词云

把每天的想法记下来，自动提取中英文关键词，并用可点击的词云帮助自己决定先关注什么。点击一个词会提高它的关注次数与字号；下方可查看与它有关的原始想法。

## 功能

- 保存、编辑和删除想法；从中文句子和英文文本提取关键词，也可用逗号补充自己的关键词，或切换到只用手动关键词。
- 同一个词在多条想法中出现时会变大；每次点击后再增加字号。可以撤回一次关注。
- 词云和关键词按钮都能操作，方便触屏和键盘使用。
- 数据保存在**当前浏览器的 localStorage**。可导出 JSON 备份，再在另一个浏览器中导入；导入会合并记录，不会覆盖已有想法。
- 静态页面，无后端、账户或第三方数据传输。清除浏览器网站数据会删除本地记录，因此建议定期导出备份。

## 本地运行

在仓库根目录运行：

```sh
python3 -m http.server 8080 --directory dist
```

打开 `http://localhost:8080`。页面无需构建或依赖安装。

## 上游项目

词云布局与 Canvas 点击检测使用 [timdream/wordcloud2.js](https://github.com/timdream/wordcloud2.js)（npm 包 `wordcloud`，版本 1.2.3，MIT License）。本仓库直接收录其官方 `src/wordcloud2.js` 与 `LICENSE`，位于 `dist/vendor/`。想法记录、关键词提取、关注逻辑及页面界面由本项目实现。

## 部署

### GitHub Pages

访问地址：[DailySpark on GitHub Pages](https://neiahsing.github.io/ciyun_DailySpark/)；源码仓库：[neiaHsing/ciyun_DailySpark](https://github.com/neiaHsing/ciyun_DailySpark)。

1. 将此仓库推送到 GitHub，默认分支设为 `main`。使用 GitHub Free 时，仓库需设为公开。
2. 打开仓库的 **Settings → Pages → Build and deployment**，将 **Source** 设为 **GitHub Actions**。
3. 推送到 `main`，或在 **Actions → Deploy GitHub Pages → Run workflow** 手动运行。工作流直接发布 `dist/` 下的静态文件，无需构建。
4. 等待工作流成功，然后从 **Settings → Pages → Visit site** 打开站点。普通项目仓库的地址通常是 `https://<用户名>.github.io/<仓库名>/`。

GitHub Pages 站点会公开供任何人访问，页面代码也会随公开仓库可见。想法记录、关注次数等内容仍只保存在**当前浏览器对该站点的 localStorage**，不会因为部署而同步到 GitHub。浏览器和站点地址不同，数据也各自独立：从现有站点或本地预览迁移时，请先在原站点导出 JSON，再到 GitHub Pages 站点导入。清除浏览器网站数据前，也请先导出备份。
