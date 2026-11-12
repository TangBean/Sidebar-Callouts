import assert from "node:assert/strict";
import test from "node:test";
import { MarkdownView, TFile } from "obsidian";
import { parseCallouts } from "../src/callouts.ts";
import { deleteCallout, getFileEditor, getFileView } from "../src/delete-callout.ts";

const snapshot = "Before\n\n> [!note] Target\n> body\n>\n> > nested quote\n> ending\n\nAfter\n\n> [!tip] Keep\n> keep body\n";
const expected = "Before\n\nAfter\n\n> [!tip] Keep\n> keep body\n";

function makeEditor(initial) {
	let markdown = initial;
	const edits = [];
	const positionToOffset = ({ line, ch }) => {
		const lines = markdown.split("\n");
		return lines.slice(0, line).reduce((total, value) => total + value.length + 1, 0) + ch;
	};
	return {
		edits,
		getValue: () => markdown,
		offsetToPos: (offset) => {
			const lines = markdown.slice(0, offset).split("\n");
			return { line: lines.length - 1, ch: lines.at(-1).length };
		},
		replaceRange: (text, from, to) => {
			edits.push({ text, from, to });
			markdown = markdown.slice(0, positionToOffset(from)) + text + markdown.slice(positionToOffset(to));
		},
	};
}

function setup({ disk = snapshot, views = [], active = views[0] ?? null } = {}) {
	const state = { disk, views, active, processFiles: [], writes: [] };
	const app = {
		workspace: {
			getActiveViewOfType: () => state.active,
			getLeavesOfType: () => state.views.map((view) => ({ view })),
		},
		vault: {
			process: async (file, callback) => {
				state.processFiles.push(file);
				const next = callback(state.disk);
				if (next !== state.disk) state.writes.push({ file, markdown: next });
				state.disk = next;
			},
		},
	};
	return { app, state };
}

function deferred() {
	let resolve;
	const promise = new Promise((done) => { resolve = done; });
	return { promise, resolve };
}

test("source deletion is one editor operation and preserves all non-target text", async () => {
	const file = new TFile("original.md");
	const editor = makeEditor(snapshot);
	const { app, state } = setup({ views: [new MarkdownView(file, editor)] });
	assert.equal(await deleteCallout(app, file, snapshot, parseCallouts(snapshot)[0]), true);
	assert.equal(editor.getValue(), expected);
	assert.equal(editor.edits.length, 1);
	assert.deepEqual(state.processFiles, []);
	assert.equal(state.disk, snapshot);
});

test("changed source contents reject a stale sidebar target without editing or vault access", async () => {
	const file = new TFile("original.md");
	const changed = snapshot.replace("Before", "Unsaved changes before");
	const editor = makeEditor(changed);
	const { app, state } = setup({ views: [new MarkdownView(file, editor)] });
	assert.equal(await deleteCallout(app, file, snapshot, parseCallouts(snapshot)[0]), false);
	assert.equal(editor.getValue(), changed);
	assert.deepEqual(editor.edits, []);
	assert.deepEqual(state.processFiles, []);
});

test("switching active files still deletes only from the file captured by the menu", async () => {
	const file = new TFile("original.md");
	const otherFile = new TFile("other.md");
	const editor = makeEditor(snapshot);
	const otherEditor = makeEditor(snapshot);
	const originalView = new MarkdownView(file, editor);
	const otherView = new MarkdownView(otherFile, otherEditor);
	const { app, state } = setup({ views: [otherView, originalView], active: otherView });
	assert.equal(await deleteCallout(app, file, snapshot, parseCallouts(snapshot)[0]), true);
	assert.equal(editor.getValue(), expected);
	assert.equal(otherEditor.getValue(), snapshot);
	assert.deepEqual(otherEditor.edits, []);
	assert.deepEqual(state.processFiles, []);
});

test("editor lookup prefers an active source view and excludes reading views", () => {
	const file = new TFile("original.md");
	const first = new MarkdownView(file, makeEditor(snapshot));
	const active = new MarkdownView(file, makeEditor(snapshot));
	const reading = new MarkdownView(file, makeEditor(snapshot), "preview");
	const { app, state } = setup({ views: [reading, first, active], active });
	assert.equal(getFileEditor(app, file), active.editor);
	state.active = reading;
	assert.equal(getFileEditor(app, file), first.editor);
	state.views = [reading];
	assert.equal(getFileEditor(app, file), null);
});

test("view lookup includes preview views while preferring the active matching file", () => {
	const file = new TFile("original.md");
	const first = new MarkdownView(file, makeEditor(snapshot));
	const preview = new MarkdownView(file, makeEditor(snapshot), "preview");
	const other = new MarkdownView(new TFile("other.md"), makeEditor(snapshot));
	const { app, state } = setup({ views: [first, preview, other], active: preview });
	assert.equal(getFileView(app, file), preview);
	state.active = other;
	assert.equal(getFileView(app, file), first);
	state.views = [preview, other];
	assert.equal(getFileView(app, file), preview);
	state.views = [other];
	assert.equal(getFileView(app, file), null);
});

for (const mode of ["reading", "closed"]) {
	test(`${mode} file deletion uses Vault.process and preserves the surrounding note`, async () => {
		const file = new TFile("original.md");
		const editor = makeEditor("A reading view editor is not the current source");
		const views = mode === "reading" ? [new MarkdownView(file, editor, "preview")] : [];
		if (views[0]) views[0].data = snapshot;
		const { app, state } = setup({ views });
		assert.equal(await deleteCallout(app, file, snapshot, parseCallouts(snapshot)[0]), true);
		assert.equal(state.disk, expected);
		assert.deepEqual(state.processFiles, [file]);
		assert.deepEqual(editor.edits, []);
	});
}

test("preview deletion waits for pending view contents to save before processing the file", async () => {
	const file = new TFile("original.md");
	const oldDisk = snapshot.replace("Before", "Old disk contents");
	const view = new MarkdownView(file, makeEditor("Stale hidden editor"), "preview");
	view.data = snapshot;
	const { app, state } = setup({ disk: oldDisk, views: [view] });
	const save = deferred();
	const order = [];
	view.saveHandler = async () => {
		order.push("save started");
		await save.promise;
		state.disk = view.getViewData();
		order.push("save completed");
	};
	const process = app.vault.process;
	app.vault.process = async (...args) => { order.push("process"); return process(...args); };
	const deletion = deleteCallout(app, file, snapshot, parseCallouts(snapshot)[0]);
	assert.deepEqual(order, ["save started"]);
	assert.deepEqual(state.processFiles, []);
	assert.equal(state.disk, oldDisk);
	save.resolve();
	assert.equal(await deletion, true);
	assert.deepEqual(order, ["save started", "save completed", "process"]);
	assert.deepEqual(view.saves, [{ file, markdown: snapshot }]);
	assert.equal(state.disk, expected);
	assert.deepEqual(view.editor.edits, []);
});

test("changed preview contents reject a stale target before saving", async () => {
	const file = new TFile("original.md");
	const view = new MarkdownView(file, makeEditor(snapshot), "preview");
	view.data = "Changed preview\n" + snapshot;
	const { app, state } = setup({ views: [view] });
	assert.equal(await deleteCallout(app, file, snapshot, parseCallouts(snapshot)[0]), false);
	assert.deepEqual(view.saves, []);
	assert.deepEqual(state.processFiles, []);
	assert.equal(state.disk, snapshot);
});

for (const change of ["file", "contents"]) {
	test(`preview ${change} changing while save waits cancels deletion`, async () => {
		const file = new TFile("original.md");
		const view = new MarkdownView(file, makeEditor(snapshot), "preview");
		const { app, state } = setup({ views: [view] });
		const save = deferred();
		view.saveHandler = () => save.promise;
		const deletion = deleteCallout(app, file, snapshot, parseCallouts(snapshot)[0]);
		assert.equal(view.saves.length, 1);
		if (change === "file") view.file = new TFile("other.md");
		else view.data = "Changed while saving\n" + snapshot;
		save.resolve();
		assert.equal(await deletion, false);
		assert.deepEqual(state.processFiles, []);
		assert.equal(state.disk, snapshot);
	});
}

test("preview save errors propagate without attempting deletion", async () => {
	const file = new TFile("original.md");
	const view = new MarkdownView(file, makeEditor(snapshot), "preview");
	const { app, state } = setup({ views: [view] });
	const failure = new Error("Pending save failed");
	view.saveHandler = async () => { throw failure; };
	await assert.rejects(deleteCallout(app, file, snapshot, parseCallouts(snapshot)[0]), (error) => error === failure);
	assert.deepEqual(state.processFiles, []);
	assert.equal(state.disk, snapshot);
});

test("switching to another source file still processes only the original file", async () => {
	const file = new TFile("original.md");
	const otherEditor = makeEditor(snapshot);
	const { app, state } = setup({ views: [new MarkdownView(new TFile("other.md"), otherEditor)] });
	assert.equal(await deleteCallout(app, file, snapshot, parseCallouts(snapshot)[0]), true);
	assert.deepEqual(state.processFiles, [file]);
	assert.deepEqual(state.writes, [{ file, markdown: expected }]);
	assert.equal(otherEditor.getValue(), snapshot);
	assert.deepEqual(otherEditor.edits, []);
});

test("Vault.process validates its latest contents before applying the snapshot range", async () => {
	const file = new TFile("original.md");
	const changed = "Concurrent change\n" + snapshot;
	const { app, state } = setup({ disk: changed });
	assert.equal(await deleteCallout(app, file, snapshot, parseCallouts(snapshot)[0]), false);
	assert.deepEqual(state.processFiles, [file]);
	assert.deepEqual(state.writes, []);
	assert.equal(state.disk, changed);
});

test("a source editor opened while process waits prevents overwriting unsaved contents", async () => {
	const file = new TFile("original.md");
	const { app, state } = setup();
	let release;
	const queued = new Promise((resolve) => { release = resolve; });
	const process = app.vault.process;
	app.vault.process = async (...args) => { await queued; return process(...args); };
	const deletion = deleteCallout(app, file, snapshot, parseCallouts(snapshot)[0]);
	const unsaved = snapshot.replace("body", "unsaved body");
	const editor = makeEditor(unsaved);
	state.views = [new MarkdownView(file, editor)];
	state.active = state.views[0];
	release();
	assert.equal(await deletion, false);
	assert.equal(state.disk, snapshot);
	assert.equal(editor.getValue(), unsaved);
	assert.deepEqual(state.writes, []);
	assert.deepEqual(editor.edits, []);
});

test("preview contents changed while process waits cannot be overwritten by deletion", async () => {
	const file = new TFile("original.md");
	const view = new MarkdownView(file, makeEditor(snapshot), "preview");
	const { app, state } = setup({ views: [view] });
	const waiting = deferred();
	const queued = deferred();
	const process = app.vault.process;
	app.vault.process = async (...args) => {
		waiting.resolve();
		await queued.promise;
		return process(...args);
	};
	const deletion = deleteCallout(app, file, snapshot, parseCallouts(snapshot)[0]);
	await waiting.promise;
	view.data = "Preview changed after save\n" + snapshot;
	queued.resolve();
	assert.equal(await deletion, false);
	assert.deepEqual(state.writes, []);
	assert.equal(state.disk, snapshot);
});

test("a different preview view opened while process waits is checked before deletion", async () => {
	const file = new TFile("original.md");
	const { app, state } = setup();
	const queued = deferred();
	const process = app.vault.process;
	app.vault.process = async (...args) => { await queued.promise; return process(...args); };
	const deletion = deleteCallout(app, file, snapshot, parseCallouts(snapshot)[0]);
	const preview = new MarkdownView(file, makeEditor(snapshot), "preview");
	preview.data = "Unsaved preview from a new view\n" + snapshot;
	state.views = [preview];
	state.active = preview;
	queued.resolve();
	assert.equal(await deletion, false);
	assert.deepEqual(state.writes, []);
	assert.equal(state.disk, snapshot);
});

test("vault write errors propagate to the caller", async () => {
	const file = new TFile("original.md");
	const { app } = setup();
	const failure = new Error("Disk write failed");
	app.vault.process = async () => { throw failure; };
	await assert.rejects(deleteCallout(app, file, snapshot, parseCallouts(snapshot)[0]), (error) => error === failure);
});

for (const mode of ["source", "vault"]) {
	test(`repeated ${mode} deletion cannot delete the following callout`, async () => {
		const file = new TFile("original.md");
		const editor = makeEditor(snapshot);
		const views = mode === "source" ? [new MarkdownView(file, editor)] : [];
		const { app, state } = setup({ views });
		const target = parseCallouts(snapshot)[0];
		assert.deepEqual(await Promise.all([
			deleteCallout(app, file, snapshot, target),
			deleteCallout(app, file, snapshot, target),
		]), [true, false]);
		assert.equal(mode === "source" ? editor.getValue() : state.disk, expected);
		assert.equal(mode === "source" ? editor.edits.length : state.writes.length, 1);
	});
}
