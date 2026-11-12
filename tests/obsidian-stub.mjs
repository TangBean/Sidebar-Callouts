export class TestElement extends EventTarget {
	children = [];
	dataset = {};
	attributes = new Map();
	classes = new Set();
	textContent = "";

	constructor({ cls = "", text = "" } = {}) {
		super();
		this.addClass(cls);
		this.textContent = text;
	}

	addClass(...names) {
		for (const name of names.flatMap((value) => value.split(/\s+/)).filter(Boolean)) {
			this.classes.add(name);
		}
	}

	createDiv(options = {}) {
		const child = new TestElement(options);
		this.children.push(child);
		return child;
	}

	createSpan(options = {}) {
		return this.createDiv(options);
	}

	empty() {
		this.children = [];
		this.textContent = "";
	}

	setText(text) {
		this.textContent = text;
	}

	setAttr(name, value) {
		this.attributes.set(name, value);
	}

	querySelectorAll(selector) {
		const result = [];
		for (const child of this.children) {
			if (child.classes.has(selector.slice(1))) result.push(child);
			result.push(...child.querySelectorAll(selector));
		}
		return result;
	}

	querySelector(selector) {
		return this.querySelectorAll(selector)[0] ?? null;
	}
}

export class Component {
	children = [];
	cleanups = [];
	loaded = false;

	load() {
		this.loaded = true;
		for (const child of this.children) child.load();
	}

	unload() {
		for (const child of this.children) child.unload();
		for (const cleanup of this.cleanups.splice(0).reverse()) cleanup();
		this.children = [];
		this.loaded = false;
	}

	register(cleanup) {
		this.cleanups.push(cleanup);
	}

	registerDomEvent(element, name, callback) {
		element.addEventListener(name, callback);
		this.register(() => element.removeEventListener(name, callback));
	}

	addChild(child) {
		this.children.push(child);
		if (this.loaded) child.load();
		return child;
	}

	removeChild(child) {
		child.unload();
		this.children = this.children.filter((value) => value !== child);
		return child;
	}
}

export class ItemView extends Component {
	constructor(leaf) {
		super();
		this.app = leaf.app;
		this.contentEl = new TestElement();
	}
}

export class MarkdownView {
	saves = [];
	saveHandler = null;

	constructor(file, editor, mode = "source") {
		this.file = file;
		this.editor = editor;
		this.mode = mode;
		this.data = editor.getValue();
	}

	getMode() {
		return this.mode;
	}

	getViewData() {
		return this.mode === "source" ? this.editor.getValue() : this.data;
	}

	async save() {
		this.saves.push({ file: this.file, markdown: this.getViewData() });
		await this.saveHandler?.(this);
	}
}

export class TFile {
	constructor(path) {
		this.path = path;
		this.extension = path.split(".").at(-1);
	}
}

class MenuItem {
	setTitle(value) { this.title = value; return this; }
	setIcon(value) { this.icon = value; return this; }
	setWarning(value) { this.warning = value; return this; }
	onClick(callback) { this.action = callback; return this; }
}

export class Menu {
	static lastShown = null;
	items = [];
	visible = false;

	addItem(callback) {
		const item = new MenuItem();
		callback(item);
		this.items.push(item);
		return this;
	}

	onHide(callback) {
		this.hideCallback = callback;
		return this;
	}

	showAtMouseEvent(event) {
		this.event = event;
		this.visible = true;
		Menu.lastShown = this;
	}

	hide() {
		if (!this.visible) return;
		this.visible = false;
		this.hideCallback?.();
	}
}

export function setIcon(element, icon) {
	element.icon = icon;
}
