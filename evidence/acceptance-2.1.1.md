# 真实会话验收：@yitian951012/dsh-project-dev-flow@2.1.1

> 时间：2026-11-20T10:51:44.162Z · profile：`headless` · 结论：**blocked**

模型凭据未注入 CLI：任务未真正执行，不能记为通过

## 前置条件

- 目标 profile 必须有一条可用的模型路由（桌面端凭据不会自动注入 CLI）
- DSH 需提供 skill / skill-filesystem / tool-skill / commands 插件（base 自带）

## 装配（不调用模型）

- 技能目录进入运行时配置：是
- customSkillDirs 可见：是
- 路径：`E:/dsh-workspace/项目管理/dsh-project-dev-flow/skills`

## 任务

| 任务 | 类型 | 期望命中 | 退出码 | 命中 | 错误 |
| :--- | :--- | :--- | ---: | :---: | :--- |
| `route-docs` | route | `project-docs` | 1 | 否 | MISSING_CREDENTIAL |
| `route-intake` | route | `project-intake` | 1 | 否 | MISSING_CREDENTIAL |
| `slash-acceptance` | slash | `project-acceptance` | 1 | 否 | MISSING_CREDENTIAL |

## 阻塞原因（原文）

```text
llm-deepseek: no API key for provider route "deepseek-official"; store DEEPSEEK_API_KEY through the credentials service (the web Models page writes it), or export DEEPSEEK_API_KEY in the launching environment
```

> 本文件是验收证据，不是承诺：只有 status=passed 且三条任务均命中，才算真实会话通过。
