import assert from "node:assert/strict";
import test from "node:test";
import { getCalloutDeletion, parseCallouts } from "../src/callouts.ts";

function deleteCallout(markdown, index = 0) {
	const callout = parseCallouts(markdown)[index];
	assert.ok(callout, "The selected callout must exist");
	const change = getCalloutDeletion(markdown, callout);
	assert.ok(change, "The callout must produce a deletion");
	return markdown.slice(0, change.from) + change.text + markdown.slice(change.to);
}

test("deletes the complete callout and joins the surrounding paragraphs with one blank line", () => {
	const markdown = "上面的正文\n\n\n> [!note] 标题\n> 第一行内容\n> 第二行内容\n\n\n下面的正文\n";
	assert.equal(deleteCallout(markdown), "上面的正文\n\n下面的正文\n");
});

for (const [name, before, after] of [
	["no blank lines", "", ""],
	["one blank line on each side", "\n", "\n"],
	["blank lines only above", "\n\n", ""],
	["blank lines only below", "", "\n\n"],
	["blank lines on both sides", "\n\n", "\n\n\n"],
	["spaces and tabs on blank lines", "  \n\t \n", "\t\n \n"],
]) {
	test(`normalizes ${name} around the deleted callout`, () => {
		const markdown = `Before\n${before}> [!note] Delete\n> Body\n${after}# After`;
		assert.equal(deleteCallout(markdown), "Before\n\n# After");
	});
}

test("removes leading blank lines with a callout at the start", () => {
	assert.equal(deleteCallout("\n \t\n> [!note]\n> Body\n\n\nAfter\n"), "After\n");
});

test("removes trailing blank lines while preserving the original final newline", () => {
	assert.equal(deleteCallout("Before\n\n> [!note]\n> Body\n\n \t\n"), "Before\n");
});

test("does not introduce a final newline when the document had none", () => {
	assert.equal(deleteCallout("Before\n\n> [!note]\n> Last line"), "Before");
	assert.equal(deleteCallout("Before\n\n> [!note]\n> Body\n \t"), "Before");
	assert.equal(deleteCallout("> [!note]\n> Body\n\nAfter"), "After");
});

test("deleting the only callout leaves an empty document", () => {
	for (const markdown of [
		"> [!note]",
		"> [!note]\n",
		"> [!note]\n> Body",
		"\n \n> [!note]\n> Body\n\n\t\n",
	]) {
		assert.equal(deleteCallout(markdown), "");
	}
});

test("retains the next adjacent callout at the same quote level", () => {
	const markdown = "Before\n> [!note] Delete\n> Body\n> [!tip]+ Keep\n> Tip body\n# After";
	const callouts = parseCallouts(markdown);
	assert.deepEqual(callouts.map(({ line, endLine }) => ({ line, endLine })), [
		{ line: 1, endLine: 3 },
		{ line: 3, endLine: 5 },
	]);
	assert.equal(deleteCallout(markdown), "Before\n\n> [!tip]+ Keep\n> Tip body\n# After");
});

test("retains the previous adjacent callout when deleting the second", () => {
	const markdown = "> [!note] Keep\n> Body\n> [!tip] Delete\n> Tip body\n# After";
	assert.equal(deleteCallout(markdown, 1), "> [!note] Keep\n> Body\n\n# After");
});

test("deletes nested quoted content as part of the outer callout", () => {
	const markdown = "Before\n> [!note] Outer\n> Body\n> > [!warning] Nested\n> > Nested body\n>\n> Final body\n# After";
	assert.equal(parseCallouts(markdown).length, 1);
	assert.equal(parseCallouts(markdown)[0].endLine, 7);
	assert.equal(deleteCallout(markdown), "Before\n\n# After");
});

test("deletes lazy paragraph continuation with the rest of the callout", () => {
	const markdown = "Before\n\n> [!note] Title\n> Quoted first\nLazy paragraph continuation\n> Quoted final\n\nAfter";
	assert.equal(parseCallouts(markdown)[0].endLine, 6);
	assert.equal(deleteCallout(markdown), "Before\n\nAfter");
});

test("continues through an empty quoted line but stops at an actual blank line", () => {
	const markdown = "> [!note]\n>\nLazy paragraph\n\n> Separate quote\n\nAfter";
	assert.equal(parseCallouts(markdown)[0].endLine, 3);
	assert.equal(deleteCallout(markdown), "> Separate quote\n\nAfter");
});

for (const block of [
	"# Heading",
	"###### Heading",
	"    Indented code",
	"\tIndented code",
	"- List item",
	"* List item",
	"+ List item",
	"-",
	"*",
	"+",
	"1. Ordered item",
	"1) Ordered item",
	"---",
	"* * *",
	"_ _ _",
	"```js",
	"~~~",
	"<div>",
	"<pre>",
	"<script>",
	"<!-- comment",
	"<?processing",
	"<!DOCTYPE html>",
]) {
	test(`preserves the independent block starting with ${JSON.stringify(block)}`, () => {
		const markdown = `Before\n> [!note] Delete\n> Body\n${block}\n\nAfter`;
		assert.equal(parseCallouts(markdown)[0].endLine, 3);
		assert.equal(deleteCallout(markdown), `Before\n\n${block}\n\nAfter`);
	});
}

for (const continuation of [
	"Ordinary paragraph",
	"2. Second item",
	"2) Second item",
	"=====",
	"[reference]: destination",
	"####### Not a heading",
	"<span>inline</span>",
	"<custom>",
	"<x-custom>inline</x-custom>",
]) {
	test(`includes lazy continuation ${JSON.stringify(continuation)}`, () => {
		const markdown = `Before\n> [!note] Delete\n> Body\n${continuation}\n\nAfter`;
		assert.equal(parseCallouts(markdown)[0].endLine, 4);
		assert.equal(deleteCallout(markdown), "Before\n\nAfter");
	});
}

test("keeps a quoted fence active across lazy continuation", () => {
	const markdown = "Before\n> [!note] Delete\n> ```markdown\nUnquoted code\n> [!warning] Code example\n> ```\n> [!tip] Keep\n> Body\n\nAfter";
	assert.deepEqual(parseCallouts(markdown).map(({ title, endLine }) => ({ title, endLine })), [
		{ title: "Delete", endLine: 6 },
		{ title: "Keep", endLine: 8 },
	]);
	assert.equal(deleteCallout(markdown), "Before\n\n> [!tip] Keep\n> Body\n\nAfter");
});

for (const marker of ["```", "~~~"]) {
	test(`ignores callout headers inside outer ${marker} code fences`, () => {
		const markdown = `${marker}markdown\n> [!note] Fake\n> Fake body\n${marker}\n\n> [!tip] Real\n> Body\n# After`;
		assert.deepEqual(parseCallouts(markdown).map((callout) => callout.title), ["Real"]);
		assert.equal(deleteCallout(markdown), `${marker}markdown\n> [!note] Fake\n> Fake body\n${marker}\n\n# After`);
	});

	test(`keeps apparent headers inside a callout's quoted ${marker} fence in that callout`, () => {
		const markdown = `Before\n> [!note] Delete\n> ${marker}markdown\n> [!warning] Code example\n> > Quoted code\n> ${marker}\n> Tail\n> [!tip] Keep\n> Body\n# After`;
		assert.deepEqual(parseCallouts(markdown).map(({ title, endLine }) => ({ title, endLine })), [
			{ title: "Delete", endLine: 7 },
			{ title: "Keep", endLine: 9 },
		]);
		assert.equal(deleteCallout(markdown), "Before\n\n> [!tip] Keep\n> Body\n# After");
	});
}

test("ignores a fake callout inside a standalone quoted fence", () => {
	const markdown = "> ```markdown\n> [!note] Fake\n> ```\n\n> [!note] Real\n> Body";
	assert.deepEqual(parseCallouts(markdown).map((callout) => callout.title), ["Real"]);
});

test("does not list callout-shaped lines indented as code", () => {
	const markdown = "\t> [!note] Tab-indented code\n    > [!tip] Space-indented code\n\n> [!note] Real";
	assert.deepEqual(parseCallouts(markdown).map((callout) => callout.title), ["Real"]);
});

test("requires a matching fence marker and a sufficiently long closing fence", () => {
	const markdown = "````markdown\n```\n> [!note] Fake one\n~~~~\n> [!note] Fake two\n```` trailing text\n> [!note] Fake three\n`````\n> [!tip] Real";
	assert.deepEqual(parseCallouts(markdown).map((callout) => callout.title), ["Real"]);
});

test("ends an unclosed quoted fence when its quote container ends", () => {
	const markdown = "> [!note] First\n> ```markdown\n> [!warning] Fake\n# Heading\n> [!tip] Second";
	assert.deepEqual(parseCallouts(markdown).map(({ title, endLine }) => ({ title, endLine })), [
		{ title: "First", endLine: 3 },
		{ title: "Second", endLine: 5 },
	]);
	assert.equal(deleteCallout(markdown), "# Heading\n> [!tip] Second");
});

test("preserves CRLF line endings and the final CRLF", () => {
	const markdown = "Before\r\n\r\n> [!note] Delete\r\n> Body\r\n\r\nAfter\r\n";
	assert.equal(deleteCallout(markdown), "Before\r\n\r\nAfter\r\n");
	assert.equal(deleteCallout("Before\r\n\r\n> [!note]\r\n> Body\r\n"), "Before\r\n");
	assert.equal(deleteCallout("Before\r\n> [!note]\r\n> Body"), "Before");
});

test("deletes the selected occurrence when two callouts have identical text", () => {
	const markdown = "> [!note] Duplicate\n> Same body\n\nBetween\n\n> [!note] Duplicate\n> Same body\n\nAfter";
	assert.equal(deleteCallout(markdown, 1), "> [!note] Duplicate\n> Same body\n\nBetween\n\nAfter");
});

test("preserves bytes outside the deletion range, including distant blank lines and mixed endings", () => {
	const prefix = "First\r\n\r\n\r\nText with trailing spaces  \r\n";
	const suffix = "After\n\n\nLast  \n";
	const markdown = `${prefix}\t\r\n> [!note] Delete\n> Body\r\n \n${suffix}`;
	const change = getCalloutDeletion(markdown, parseCallouts(markdown)[0]);
	assert.deepEqual(change, {
		from: prefix.length,
		to: markdown.length - suffix.length,
		text: "\r\n",
	});
	assert.equal(deleteCallout(markdown), `${prefix}\r\n${suffix}`);
});

test("treats only spaces and tabs as blank-line content", () => {
	assert.equal(deleteCallout("Before\n\u00a0\n> [!note] Delete\n> Body\n# After"), "Before\n\u00a0\n\n# After");
});

test("preserves existing type aliases, titles, and fold states", () => {
	const markdown = "> [!SUMMARY]-  Explicit title  \n> Body\n\n> [!hint]+\n>\n> First content\n\n> [!custom_type-name]\n# Heading";
	assert.deepEqual(parseCallouts(markdown), [
		{ line: 0, endLine: 2, rawType: "SUMMARY", canonicalType: "abstract", title: "Explicit title", foldState: "-" },
		{ line: 3, endLine: 6, rawType: "hint", canonicalType: "tip", title: "First content", foldState: "+" },
		{ line: 7, endLine: 8, rawType: "custom_type-name", canonicalType: "custom_type-name", title: "Custom Type Name", foldState: "" },
	]);
});

test("does not delete an absent or mismatched target", () => {
	const markdown = "> [!note] Title\n> Body\n# After";
	const callout = parseCallouts(markdown)[0];
	assert.equal(getCalloutDeletion("No callouts", callout), null);
	assert.equal(getCalloutDeletion(markdown, { ...callout, line: 2 }), null);
	assert.equal(getCalloutDeletion(markdown, { ...callout, endLine: 3 }), null);
	assert.equal(getCalloutDeletion(markdown, { ...callout, title: "Changed title" }), null);
});

for (const underline of ["=====", "-----", "=", "-"]) {
	test(`preserves an adjacent Setext heading with ${underline}`, () => {
		const outside = `Keep heading\n${underline}`;
		const markdown = `Before\n\n> [!note] Delete\n> Body\n${outside}\n\nAfter`;
		assert.equal(parseCallouts(markdown)[0].endLine, 4);
		assert.equal(deleteCallout(markdown), `Before\n\n${outside}\n\nAfter`);
	});
}

test("only the line immediately before a Setext underline starts the outside heading", () => {
	const markdown = "> [!note]\n> Body\nFirst lazy line\nSecond line\n=====";
	assert.equal(parseCallouts(markdown)[0].endLine, 3);
	assert.equal(deleteCallout(markdown), "Second line\n=====");
});

for (const underline of [" ===", "=== ", "===\t", "> ==="]) {
	test(`keeps non-Setext continuation with ${JSON.stringify(underline)} in the callout`, () => {
		assert.equal(deleteCallout(`> [!note]\n> Body\nHeading\n${underline}\n\nAfter`), "After");
	});
}

for (const outside of [
	"$$\nx^2\n$$", "$$ first line\nsecond", "$$$x\n", "$$\n",
	"%%\nKeep this comment\n%%", "%% first line\nsecond", "%%", "%% comment",
	'<meta charset="utf-8">', "<hgroup>\nKeep\n</hgroup>", "</pre>", "<pre/>",
	"<!doctype html>", '<div\u00a0class="x">', '<script\u00a0src="x">',
]) {
	test(`preserves an adjacent standalone block ${JSON.stringify(outside)}`, () => {
		const markdown = `> [!note]\n> Body\n${outside}`;
		assert.equal(parseCallouts(markdown)[0].endLine, 2);
		assert.equal(deleteCallout(markdown), outside);
	});
}

for (const continuation of [
	"$$x$$", "$$ x $$", "text $$math$$", "$$x$", "%%comment%%", "%% comment %%",
	"text %%comment%%", "%%first%line", "%%%", "<textarea>\ninside\n</textarea>",
	"<script/>", "</script>", "<style/>", "</style>",
]) {
	test(`retains inline or lazy continuation ${JSON.stringify(continuation)}`, () => {
		assert.equal(deleteCallout(`> [!note]\n> Body\n${continuation}\n\nAfter`), "After");
	});
}

for (const text of ["$$", "$$ x"]) {
	test(`math-like text ${JSON.stringify(text)} without a final newline stays in the callout`, () => {
		assert.equal(deleteCallout(`> [!note]\n> Body\n${text}`), "");
	});
}

for (const newline of ["\n", "\r\n"]) {
	test(`a non-ASCII blank line terminates the callout without deleting following text (${JSON.stringify(newline)})`, () => {
		const outside = `\u00a0${newline}Outside paragraph${newline}${newline}After`;
		const markdown = `> [!note] Delete${newline}> Body${newline}${outside}`;
		assert.equal(parseCallouts(markdown)[0].endLine, 2);
		assert.equal(deleteCallout(markdown), outside);
	});
}

test("an outside Setext heading also ends a quoted code fence", () => {
	const markdown = "> [!note]\n> ```\nlazy code\nKeep heading\n=====\n\n> [!tip] Next";
	assert.deepEqual(parseCallouts(markdown).map(({ line, endLine }) => [line, endLine]), [[0, 3], [6, 7]]);
	assert.equal(deleteCallout(markdown), "Keep heading\n=====\n\n> [!tip] Next");
});

for (const [fencePrefix, headingPrefix, underlinePrefix] of [
	["> > ", "", "> "],
	["> > ", "> ", "> "],
	["> > > ", "", "> > "],
	["> > > ", "> ", "> > "],
]) {
	test(`a nested fence ends at a Setext heading across missing quote markers (${JSON.stringify([fencePrefix, headingPrefix, underlinePrefix])})`, () => {
		const markdown = `> [!note] Outer\n${fencePrefix}\`\`\`\n${headingPrefix}Heading\n${underlinePrefix}===\n> [!tip] Keep\n> Body`;
		assert.deepEqual(parseCallouts(markdown).map(({ line, endLine }) => [line, endLine]), [[0, 4], [4, 6]]);
		assert.equal(deleteCallout(markdown), "> [!tip] Keep\n> Body");
	});
}
