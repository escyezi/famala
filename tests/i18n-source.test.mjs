import { test, expect } from 'vitest';
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import ts from 'typescript';

const resourceFiles = new Set(['i18n/zh-CN.ts', 'i18n/en.ts']);
async function sourceFiles(root, directory = root) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await sourceFiles(root, path)));
    else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
      const name = relative(root, path).split(sep).join('/');
      if (!resourceFiles.has(name)) files.push(name);
    }
  }
  return files.sort();
}

function isLanguageGlyph(file, node) {
  if (file !== 'components/LanguageToggle.tsx' || !ts.isStringLiteral(node) || node.text !== '文')
    return false;
  const conditional = node.parent;
  if (!ts.isConditionalExpression(conditional)) return false;
  const expression = conditional.parent;
  if (!ts.isJsxExpression(expression)) return false;
  const element = expression.parent;
  if (!ts.isJsxElement(element) || element.openingElement.tagName.getText() !== 'text')
    return false;
  const svg = element.parent;
  if (!ts.isJsxElement(svg) || svg.openingElement.tagName.getText() !== 'svg') return false;
  return element.openingElement.attributes.properties.some(
    (attribute) =>
      ts.isJsxAttribute(attribute) &&
      attribute.name.getText() === 'className' &&
      attribute.initializer &&
      ts.isStringLiteral(attribute.initializer) &&
      ['language-icon-front', 'language-icon-back'].includes(attribute.initializer.text),
  );
}

function untranslatedLiterals(file, text) {
  const source = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const violations = [];
  const visit = (node) => {
    if (
      (ts.isStringLiteral(node) ||
        ts.isJsxText(node) ||
        ts.isTemplateHead(node) ||
        ts.isTemplateMiddle(node) ||
        ts.isTemplateTail(node) ||
        ts.isNoSubstitutionTemplateLiteral(node)) &&
      /\p{Script=Han}/u.test(node.text) &&
      !isLanguageGlyph(file, node)
    ) {
      violations.push({
        line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1,
        text: node.text,
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return violations;
}

test('frontend source has no hardcoded Chinese except the exact language icon glyphs', async () => {
  const root = 'src/react-app';
  for (const file of await sourceFiles(root)) {
    expect(untranslatedLiterals(file, await readFile(join(root, file), 'utf8')), file).toEqual([]);
  }
});

test('source discovery includes nested components, hooks and i18n logic, excluding only resources and declarations', async () => {
  const root = await mkdtemp(join(tmpdir(), 'famala-i18n-source-'));
  const files = [
    'App.tsx',
    'components/nested/Notice.tsx',
    'hooks/useNotice.ts',
    'i18n/format.ts',
    'i18n/zh-CN.ts',
    'i18n/en.ts',
    'vite-env.d.ts',
    'styles.css',
  ];
  try {
    for (const file of files) {
      const path = join(root, file);
      await mkdir(join(path, '..'), { recursive: true });
      await writeFile(path, '');
    }
    expect(await sourceFiles(root)).toEqual([
      'App.tsx',
      'components/nested/Notice.tsx',
      'hooks/useNotice.ts',
      'i18n/format.ts',
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test.each([
  ['hooks/useNotice.ts', "const message = '失败';", 1],
  ['components/nested/Notice.tsx', '<p>失败</p>', 1],
  ['hooks/useNotice.ts', 'const message = `共 ${count} 条，剩余 ${remaining} 个`;', 3],
  ['hooks/useNotice.ts', 'const message = `失败`;', 1],
  ['components/LanguageToggle.tsx', '<button title="切换语言" />', 1],
  [
    'components/LanguageToggle.tsx',
    '<svg><text className="language-icon-front">{english ? "En" : "文"}</text><text className="language-icon-back">{english ? "文" : "En"}</text></svg>',
    0,
  ],
  [
    'components/LanguageToggle.tsx',
    '<svg><text className="language-icon-front">{english ? "En" : "文案"}</text></svg>',
    1,
  ],
  [
    'components/LanguageToggle.tsx',
    '<svg><text className="other">{english ? "En" : "文"}</text></svg>',
    1,
  ],
  [
    'components/LanguageToggle.tsx',
    '<svg><text className="language-icon-front" title="文">{english ? "En" : "文"}</text></svg>',
    1,
  ],
  [
    'components/Other.tsx',
    '<svg><text className="language-icon-front">{english ? "En" : "文"}</text></svg>',
    1,
  ],
])('literal scanner checks %s: %s', (file, source, count) => {
  expect(untranslatedLiterals(file, source)).toHaveLength(count);
});
