import assert from "node:assert/strict";
import test from "node:test";
import { Menu, TFile } from "obsidian";
import { parseCallouts } from "../src/callouts.ts";
import { CalloutNavigatorView } from "../src/ui/callout-view.ts";

function makeState(path, title) {
	const file = new TFile(path);
	const markdown = `Before\n\n> [!note] ${title}\n> body\n\nAfter\n`;
	return { file, markdown, callouts: parseCallouts(markdown) };
}

function setup(initial) {
	const state = { activeFile: initial.file, current: initial, deleted: [], jumped: [] };
	const app = { workspace: { getActiveFile: () => state.activeFile } };
	const plugin = {
		getCurrentState: async () => state.current,
		deleteCallout: async (...args) => { state.deleted.push(args); },
		jumpToCallout: async (callout) => { state.jumped.push(callout); },
	};
	const view = new CalloutNavigatorView({ app }, plugin);
	view.load();
	return { view, plugin, state };
}

function rightClick(element) {
	const event = new Event("contextmenu", { bubbles: true, cancelable: true });
	element.dispatchEvent(event);
	assert.equal(event.defaultPrevented, true);
	return Menu.lastShown;
}

function deferred() {
	let resolve;
	const promise = new Promise((done) => { resolve = done; });
	return { promise, resolve };
}

test("right-click exposes Delete with a trash icon and keeps the original file and snapshot", async () => {
	const original = makeState("original.md", "Original target");
	const { view, state } = setup(original);
	await view.onOpen();
	const row = view.contentEl.querySelector(".callout-nav__item");
	const menu = rightClick(row);
	const entry = menu.items.find((item) => item.title === "Delete");
	assert.ok(entry, "The context menu offers Delete");
	assert.equal(entry.icon, "trash-2");
	assert.equal(entry.warning, true);
	assert.deepEqual(state.jumped, []);
	const other = makeState("other.md", "Other target");
	state.activeFile = other.file;
	state.current = other;
	await view.refresh();
	await entry.action();
	assert.deepEqual(state.deleted, [[original.file, original.markdown, original.callouts[0]]]);
	assert.equal(view.contentEl.querySelector(".callout-nav__title").textContent, "Other target");
	await view.onClose();
	view.unload();
});

test("click, Enter, and Space keep navigating; other keys do not", async () => {
	const initial = makeState("note.md", "Target");
	const { view, state } = setup(initial);
	await view.onOpen();
	const row = view.contentEl.querySelector(".callout-nav__item");
	row.dispatchEvent(new Event("click"));
	for (const key of ["Enter", " ", "Escape"]) {
		const event = new Event("keydown", { cancelable: true });
		Object.defineProperty(event, "key", { value: key });
		row.dispatchEvent(event);
		assert.equal(event.defaultPrevented, key !== "Escape");
	}
	assert.deepEqual(state.jumped, Array(3).fill(initial.callouts[0]));
	assert.deepEqual(state.deleted, []);
	await view.onClose();
	view.unload();
});

test("refresh removes handlers on previous rows and close removes current handlers and menu", async () => {
	const { view, state } = setup(makeState("note.md", "Target"));
	await view.onOpen();
	const oldRows = [];
	for (let index = 0; index < 3; index++) {
		oldRows.push(view.contentEl.querySelector(".callout-nav__item"));
		await view.refresh();
	}
	const current = view.contentEl.querySelector(".callout-nav__item");
	const menu = rightClick(current);
	for (const row of oldRows) {
		row.dispatchEvent(new Event("click"));
		const event = new Event("contextmenu", { cancelable: true });
		row.dispatchEvent(event);
		assert.equal(event.defaultPrevented, false);
	}
	assert.deepEqual(state.jumped, []);
	current.dispatchEvent(new Event("click"));
	assert.equal(state.jumped.length, 1);
	assert.equal(menu.visible, true);
	await view.onClose();
	assert.equal(menu.visible, false);
	assert.equal(view.contentEl.querySelector(".callout-nav__item"), null);
	current.dispatchEvent(new Event("click"));
	const event = new Event("contextmenu", { cancelable: true });
	current.dispatchEvent(event);
	assert.equal(event.defaultPrevented, false);
	assert.equal(state.jumped.length, 1);
	view.unload();
});

test("an older async refresh cannot replace a newer file's list", async () => {
	const first = makeState("first.md", "First target");
	const second = makeState("second.md", "Second target");
	const { view, plugin, state } = setup(first);
	const pending = deferred();
	plugin.getCurrentState = () => pending.promise;
	const oldRefresh = view.refresh();
	state.activeFile = second.file;
	plugin.getCurrentState = async () => second;
	await view.refresh();
	pending.resolve(first);
	await oldRefresh;
	assert.equal(view.contentEl.querySelector(".callout-nav__title").textContent, "Second target");
	await rightClick(view.contentEl.querySelector(".callout-nav__item")).items[0].action();
	assert.deepEqual(state.deleted, [[second.file, second.markdown, second.callouts[0]]]);
	await view.onClose();
	view.unload();
});

test("changing the active file invalidates an in-flight refresh before another refresh starts", async () => {
	const first = makeState("first.md", "First target");
	const { view, plugin, state } = setup(first);
	const pending = deferred();
	plugin.getCurrentState = () => pending.promise;
	const refresh = view.refresh();
	state.activeFile = new TFile("second.md");
	pending.resolve(first);
	await refresh;
	assert.equal(view.contentEl.querySelector(".callout-nav__item"), null);
	await view.onClose();
	view.unload();
});

test("an older refresh of the same file cannot replace its newer contents", async () => {
	const original = makeState("note.md", "Old title");
	const updated = makeState("note.md", "Updated title");
	updated.file = original.file;
	const { view, plugin, state } = setup(original);
	const pending = deferred();
	plugin.getCurrentState = () => pending.promise;
	const oldRefresh = view.refresh();
	plugin.getCurrentState = async () => updated;
	await view.refresh();
	pending.resolve(original);
	await oldRefresh;
	assert.equal(view.contentEl.querySelector(".callout-nav__title").textContent, "Updated title");
	await rightClick(view.contentEl.querySelector(".callout-nav__item")).items[0].action();
	assert.deepEqual(state.deleted, [[updated.file, updated.markdown, updated.callouts[0]]]);
	await view.onClose();
	view.unload();
});

test("closing the sidebar invalidates an in-flight refresh", async () => {
	const initial = makeState("note.md", "Target");
	const { view, plugin } = setup(initial);
	const pending = deferred();
	plugin.getCurrentState = () => pending.promise;
	const refresh = view.refresh();
	await view.onClose();
	pending.resolve(initial);
	await refresh;
	assert.equal(view.contentEl.querySelector(".callout-nav__item"), null);
	view.unload();
});

test("unloading the view hides an open menu and removes row handlers", async () => {
	const { view, state } = setup(makeState("note.md", "Target"));
	await view.onOpen();
	const row = view.contentEl.querySelector(".callout-nav__item");
	const menu = rightClick(row);
	view.unload();
	assert.equal(menu.visible, false);
	row.dispatchEvent(new Event("click"));
	assert.deepEqual(state.jumped, []);
	const event = new Event("contextmenu", { cancelable: true });
	row.dispatchEvent(event);
	assert.equal(event.defaultPrevented, false);
});
