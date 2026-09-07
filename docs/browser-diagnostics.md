# 浏览器控制台问题排查

## 表单标识

应用所有 input、select、textarea 均在模板中声明稳定的 name，包括条件弹窗、账户选择器及统计导出控件。重复分组控件可以共享 name，不使用重复 id。单元测试解析所有 Vue 模板；浏览器回归测试另外检查动态页面及 Chrome 的 FormFieldHasEmptyIdAndNameAttributes 问题。

## 匿名脚本中的 reportAllChanges / startTime

用户报告的堆栈（`:2:19429`、`:2:5652`）与 [GoogleChrome/web-vitals #792](https://github.com/GoogleChrome/web-vitals/issues/792) 完全一致。该上游报告指向 Chrome DevTools 注入的性能指标采集脚本：SPA 软导航后，延迟回调尝试读取已不存在的性能条目的 startTime。2026-09-08 检查时该 issue 仍为 open；缺失条目的具体机制是上游报告的分析，尚非本项目定位出的代码路径。

项目源码和依赖锁文件均未引入 web-vitals，也没有 reportAllChanges 或 startTime 访问。因此不在应用中覆盖 Performance API 或吞掉全局异常。可先关闭 DevTools 后刷新对照，更新 Chrome；若问题持续，在 DevTools 暂停异常处查看注入脚本，并关注上述上游修复。

## 登录页的异步消息通道关闭

`A listener indicated an asynchronous response by returning true, but the message channel closed before a response was received` 属于 Chrome 扩展消息机制：接收端返回 true 承诺稍后响应，但通道关闭时仍未响应。参见 [Chrome 消息传递文档](https://developer.chrome.com/docs/extensions/develop/concepts/messaging)。

RWBalance 登录页没有 chrome.runtime / browser.runtime 调用。账本 Web Worker 通过标准 postMessage 返回结果或错误；PWA 更新采用标准 Service Worker API，不是扩展 runtime 消息监听。报错显示在登录页不代表报错由该页面的业务脚本产生，扩展也会在登录页注入脚本。

2026-09-08 实测：无扩展 Chromium 中打开线上登录页，输入搜索、打开/关闭创建弹窗并重新加载，pageerror 为 0。桌面 Chromium 和移动端 WebKit 的本地回归覆盖登录、新建账本、六个页签往返两轮、主题调整和暂离后重载，同样未出现未捕获异常。此结果不能确定用户浏览器中是哪一个扩展产生消息错误。

在无扩展浏览器中复测首次访问、搜索、新建/导入弹窗和重新加载；若只有日常浏览器报错，在错误链接或 DevTools Sources 中查找 chrome-extension:// 来源，定位扩展后更新它，或针对本站停用再对照。当前只有错误文本，无法确定具体扩展。真正的修复需在扩展中保证所有异步分支发送响应，并处理发送端 Promise 拒绝；本项目不屏蔽全局 unhandledrejection。

## 颜色显示为 RGB

主题及预览色在源码中使用 HSL。预览通过 --preview-color 自定义变量保留 HSL 参数；浏览器 getComputedStyle、DevTools 或生产 CSS 优化仍可能将等价颜色显示为 RGB/十六进制，这不表示调色逻辑改用了 RGB。计算文字对比度时才将 HSL 转为线性颜色通道来求相对亮度。
