#!/usr/bin/env node
/**
 * tests/source-integration.test.mjs
 *
 * 作者侧（source checkout）集成测试：验证「从包根向上找到源项目 docs/」这一装法。
 * 它依赖本仓库把插件放在源文档同级的布局；包被移动或安装到别的项目后不应再跑。
 *
 * - 作者侧：`npm run test:source`（要求 docs/ 与唯一索引存在）
 * - 安装侧：`npm test` 不包含本文件，避免在无 docs/ 的环境里假失败
 *
 * 不修改任何文件；只读校验。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

import { findDocsRoot } from '../scripts/check-sources.mjs';
import { validatePackage } from '../scripts/validate-package.mjs';

const PLUGIN_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

describe('作者侧：源文档目录解析', () => {
  it('显式 --docs 指向不存在目录 → DOCS-DIR 错误（用法问题不静默）', async () => {
    const result = await validatePackage({
      root: PLUGIN_ROOT,
      docsRoot: path.join(tmpdir(), 'definitely-not-here-dpf'),
      lockPath: null,
    });
    assert.ok(result.errors.some((e) => e.rule === 'DOCS-DIR'), JSON.stringify(result.errors, null, 2));
  });

  it('findDocsRoot 从包根向上找到 docs/（本仓库的真实布局）', () => {
    const found = findDocsRoot({ root: PLUGIN_ROOT });
    assert.equal(found.source, 'ancestor');
    assert.ok(existsSync(path.join(found.dir, '00_入口_文档总索引.md')), '源文档目录应包含唯一索引');
  });
});
