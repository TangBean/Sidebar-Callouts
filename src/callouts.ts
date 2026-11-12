export interface ParsedCallout {
	line: number;
	endLine: number;
	rawType: string;
	canonicalType: string;
	title: string;
	foldState: "" | "+" | "-";
}

export interface CalloutDeletion {
	from: number;
	to: number;
	text: string;
}

interface MarkdownLine {
	text: string;
	start: number;
	end: number;
	newline: string;
}

interface Fence {
	marker: string;
	length: number;
	quoteDepth: number;
}

const TYPE_ALIASES: Record<string, string> = {
	note: "note",
	abstract: "abstract",
	summary: "abstract",
	tldr: "abstract",
	info: "info",
	todo: "todo",
	tip: "tip",
	hint: "tip",
	important: "tip",
	success: "success",
	check: "success",
	done: "success",
	question: "question",
	help: "question",
	faq: "question",
	warning: "warning",
	caution: "warning",
	attention: "warning",
	failure: "failure",
	fail: "failure",
	missing: "failure",
	danger: "danger",
	error: "danger",
	bug: "bug",
	example: "example",
	quote: "quote",
	cite: "quote",
	comment: "comment",
};

const CALLOUT_START = /^ {0,3}>\s*\[!([A-Za-z0-9_-]+)\]([+-])?\s*(.*)$/;
const QUOTED_LINE = /^ {0,3}>\s?(.*)$/;
const BLANK_LINE = /^[ \t]*$/;
const FENCE_LINE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const BLOCK_HTML_TAGS = new Set((
	"address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|"
	+ "fieldset|figcaption|figure|footer|form|frame|frameset|h1|h2|h3|h4|h5|h6|head|header|hr|html|iframe|legend|"
	+ "li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|section|source|summary|table|tbody|td|"
	+ "tfoot|th|thead|title|tr|track|ul"
).split("|"));

function interruptsBlockquote(line: string): boolean {
	if (BLANK_LINE.test(line) || /^ {4}|^ {0,3}\t/.test(line)) return true;
	const text = line.replace(/^ {0,3}/, "");
	if (/^#{1,6}(?:[ \t]|$)/.test(text)) return true;
	if (/^(?:[*+-]|1[.)])(?:[ \t]|$)/.test(text)) return true;
	if (/^(?:(?:\*[ \t]*){3,}|(?:_[ \t]*){3,}|(?:-[ \t]*){3,})$/.test(text)) return true;
	const fence = text.match(FENCE_LINE);
	if (fence && (fence[1]?.[0] !== "`" || !fence[2]?.includes("`"))) return true;
	if (/^<(?:!--|\?|![A-Z]|!\[CDATA\[)/.test(text)) return true;
	if (/^<(?:script|pre|style|textarea)(?:[ \t>]|$)/i.test(text)) return true;
	const htmlTag = text.match(/^<\/?([A-Za-z][A-Za-z0-9-]*)(?=[ \t]|\/?>|$)/)?.[1];
	return htmlTag !== undefined && BLOCK_HTML_TAGS.has(htmlTag.toLowerCase());
}

function readLines(markdown: string): MarkdownLine[] {
	const parts = markdown.split(/(\r?\n)/);
	const lines: MarkdownLine[] = [];
	let start = 0;
	for (let i = 0; i < parts.length; i += 2) {
		const text = parts[i] ?? "";
		const newline = parts[i + 1] ?? "";
		if (text.length === 0 && newline.length === 0) break;
		const end = start + text.length;
		lines.push({ text, start, end, newline });
		start = end + newline.length;
	}
	return lines;
}

function stripQuotes(line: string, depth: number): { text: string; depth: number } {
	let text = line;
	for (let i = 0; i < depth; i++) {
		const match = text.match(QUOTED_LINE);
		if (!match) return { text, depth: i };
		text = match[1] ?? "";
	}
	return { text, depth };
}

function advanceFence(line: string, fence: Fence | null): { fence: Fence | null; isCode: boolean } {
	if (fence) {
		const stripped = stripQuotes(line, fence.quoteDepth);
		if (stripped.depth === fence.quoteDepth || !interruptsBlockquote(stripped.text)) {
			const match = stripped.text.match(FENCE_LINE);
			const marker = match?.[1] ?? "";
			const closes = marker[0] === fence.marker
				&& marker.length >= fence.length
				&& BLANK_LINE.test(match?.[2] ?? "");
			return { fence: closes ? null : fence, isCode: true };
		}
	}

	let text = line;
	let quoteDepth = 0;
	let quoted = text.match(QUOTED_LINE);
	while (quoted) {
		text = quoted[1] ?? "";
		quoteDepth++;
		quoted = text.match(QUOTED_LINE);
	}
	const match = text.match(FENCE_LINE);
	const marker = match?.[1] ?? "";
	if (!marker || (marker[0] === "`" && match?.[2]?.includes("`"))) {
		return { fence: null, isCode: false };
	}
	return {
		fence: { marker: marker[0] ?? "", length: marker.length, quoteDepth },
		isCode: true,
	};
}

function calloutTitle(lines: MarkdownLine[], line: number, rawType: string, rawTitle: string): string {
	if (rawTitle.length > 0) return rawTitle;
	for (let i = line + 1; i < lines.length; i++) {
		const continuation = lines[i]?.text.match(QUOTED_LINE);
		if (!continuation) break;
		const text = (continuation[1] ?? "").trim();
		if (text.length > 0) return text;
	}
	return rawType.replace(/[-_]+/g, " ").replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function parseLines(lines: MarkdownLine[]): ParsedCallout[] {
	const result: ParsedCallout[] = [];
	let current: ParsedCallout | null = null;
	let fence: Fence | null = null;
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (!line) continue;
		if (!QUOTED_LINE.test(line.text) && interruptsBlockquote(line.text)) current = null;
		const state = advanceFence(line.text, fence);
		fence = state.fence;
		const match = state.isCode ? null : line.text.match(CALLOUT_START);
		const rawType = match?.[1];
		if (match && rawType !== undefined) {
			const lower = rawType.toLowerCase();
			const fold = match[2];
			current = {
				line: i,
				endLine: i + 1,
				rawType,
				canonicalType: TYPE_ALIASES[lower] ?? lower,
				title: calloutTitle(lines, i, rawType, match[3]?.trim() ?? ""),
				foldState: fold === "+" || fold === "-" ? fold : "",
			};
			result.push(current);
		} else if (current) {
			current.endLine = i + 1;
		}
	}
	return result;
}

export function parseCallouts(markdown: string): ParsedCallout[] {
	return parseLines(readLines(markdown));
}

export function getCalloutDeletion(markdown: string, callout: ParsedCallout): CalloutDeletion | null {
	const lines = readLines(markdown);
	const target = parseLines(lines).find((candidate) =>
		candidate.line === callout.line
		&& candidate.endLine === callout.endLine
		&& candidate.rawType === callout.rawType
		&& candidate.canonicalType === callout.canonicalType
		&& candidate.title === callout.title
		&& candidate.foldState === callout.foldState
	);
	if (!target) return null;

	let startLine = target.line;
	let endLine = target.endLine;
	while (startLine > 0 && BLANK_LINE.test(lines[startLine - 1]?.text ?? "")) startLine--;
	while (endLine < lines.length && BLANK_LINE.test(lines[endLine]?.text ?? "")) endLine++;

	const before = lines[startLine - 1];
	const after = lines[endLine];
	let from = lines[startLine]?.start ?? 0;
	if (before && !after && !markdown.endsWith("\n")) from = before.end;
	return {
		from,
		to: after?.start ?? markdown.length,
		text: before && after ? before.newline : "",
	};
}
