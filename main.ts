import axios from "axios";
import * as E from "fp-ts/lib/Either";
import { identity, pipe } from "fp-ts/lib/function";
import * as O from "fp-ts/lib/Option";
import * as TE from "fp-ts/lib/TaskEither";
import * as fs from "fs";
import {
	App,
	FileSystemAdapter,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
} from "obsidian";
import * as path from "path";

interface Settings {
	url: string;
	apiKey: string;
	apiSecret: string;
}

const DEFAULT_SETTINGS: Settings = {
	url: "",
	apiKey: "",
	apiSecret: "",
};

export default class MyPlugin extends Plugin {
	settings: Settings;

	async onload() {
		await this.loadSettings();

		const adapter = this.app.vault.adapter as FileSystemAdapter;
		const basePath = adapter.getBasePath();

		this.registerEvent(
			this.app.workspace.on("file-menu", (menu, file) => {
				if (!("extension" in file)) {
					return;
				}

				const { url, apiKey, apiSecret } = this.settings;
				const token = Buffer.from(`${apiKey}:${apiSecret}`).toString("base64");

				menu.addItem((item) => {
					item
						.setTitle("Publish file")
						.setIcon("document")
						.onClick(() =>
							pipe(
								path.join(basePath, file.path),
								log("Publishing file..."),
								TE.fromNullable(new Error("File not found")),
								TE.chain(publishFile(url, token)),
								TE.chain(moveFile),
								TE.match(
									(e) => notify(e, "File failed to publish"),
									() => notify(undefined, "File has been published")
								)
							)()
						);
				});
			})
		);

		this.addSettingTab(new BlogPublisherTab(this.app, this));
	}

	onunload() {}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

const buildFormData = (data: Record<string, any>) => {
	const form = new FormData();

	Object.entries(data).forEach(([key, value]) => form.append(key, value));

	return form;
};

const publishFile = (url: string, token: string) => (filePath: string) =>
	pipe(
		{ fileName: path.parse(filePath).name, file: fs.readFileSync(filePath) },
		buildFormData,
		TE.tryCatchK(
			(data) =>
				axios.post(url, data, {
					headers: {
						"Content-Type": "multipart/form-data",
						Authorization: "Basic " + token,
					},
				}),
			E.toError
		),
		TE.chain(() => TE.right(filePath))
	);

const createDir = (dir: string) =>
	pipe(
		dir,
		E.fromPredicate(
			(dir) => !fs.existsSync(dir),
			() => new Error("directory exists")
		),
		E.chain((dir) => E.tryCatch(() => fs.mkdirSync(dir), E.toError)),
		E.match(
			() => dir,
			() => dir
		)
	);

const log =
	(msg: string) =>
	<A>(a: A) => {
		console.log(msg);
		return a;
	};

const moveFile = (filePath: string) =>
	pipe(
		path.parse(filePath),
		O.fromPredicate(({ dir }) => !dir.contains("published")),
		O.let("file", () => filePath),
		O.let("newPath", ({ dir }) => createDir(path.join(dir, "published"))),
		O.map(({ file, base, newPath }) =>
			pipe(
				E.tryCatch(
					() => fs.renameSync(file, path.join(newPath, base)),
					E.toError
				),
				E.map(() => newPath)
			)
		),
		O.match(() => E.right<Error, string>(""), identity),
		TE.fromEither
	);

const notify = (e: Error | undefined, msg: string) => {
	console.log(msg);

	if (e) {
		console.error(e);
	}

	new Notice(msg);
};

class BlogPublisherTab extends PluginSettingTab {
	plugin: MyPlugin;

	constructor(app: App, plugin: MyPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		containerEl.createEl("h3", { text: "Blog Publisher Settings" });

		new Setting(containerEl)
			.setName("Publisher url")
			.setDesc(
				"This should be a POST url where the file is sent as a multipart/form-data body to."
			)
			.addText((text) =>
				text
					.setPlaceholder("Enter the url")
					.setValue(this.plugin.settings.url)
					.onChange(async (value) => {
						this.plugin.settings.url = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("API Key")
			.setDesc(
				"API Key used when posting a blog to the URL. NOTE: this is passed as the user of the basic authorization header."
			)
			.addText((text) =>
				text
					.setPlaceholder("Enter your key")
					.setValue(this.plugin.settings.apiKey)
					.onChange(async (value) => {
						this.plugin.settings.apiKey = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("API Secret")
			.setDesc(
				"API Secret used when posting a blog to the URL. NOTE: this is passed as the password of the basic authorization header."
			)
			.addText((text) =>
				text
					.setPlaceholder("Enter your secret")
					.setValue(this.plugin.settings.apiSecret)
					.onChange(async (value) => {
						this.plugin.settings.apiSecret = value;
						await this.plugin.saveSettings();
					})
			);
	}
}
