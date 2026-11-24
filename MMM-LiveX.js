/* global Module, Log, LivexUrl */

Module.register("MMM-LiveX", {
	defaults: {
		baseUrl: "https://livex.earth/",
		width: "480px",
		height: "",
		aspectRatio: 1,
		interactive: true,
		reloadInterval: 24 * 60 * 60 * 1000,
		unloadWhenHidden: true,
		unloadDelay: 5000, // Délai (ms) avant de décharger l'iframe quand le module est masqué
		autoPiProfile: true // Applique automatiquement un profil léger sur Raspberry Pi (ARM/Linux)
	},

	getScripts() {
		return [this.file("url.js")];
	},

	getStyles() {
		return [this.file("MMM-LiveX.css")];
	},

	start() {
		this.globe = null;
		this.iframe = null;
		this.statusEl = null;
		this.unloaded = false;
		this.reloadTimer = null;
		this.unloadTimer = null;
		this.url = null;
		this.error = null;

		// 1. Vérification native de WebGL2 avant de charger l'iframe
		const gl = this._getWebGL2Context();
		if (!gl) {
			this.error = "WebGL2 indisponible. Vérifiez ELECTRON_ENABLE_GPU=1 et le pilote graphique (vc4-kms-v3d).";
			Log.error(`${this.name}: ${this.error}`);
			return;
		}

		// 2. Profil auto-adaptatif léger sur Raspberry Pi (Linux ARM)
		const effectiveConfig = { ...this.config };
		if (effectiveConfig.autoPiProfile && this._isRaspberryPi()) {
			if (effectiveConfig.sharp === undefined) effectiveConfig.sharp = "saver";
			if (effectiveConfig.winds === undefined) effectiveConfig.winds = 0;
			if (effectiveConfig.waves === undefined) effectiveConfig.waves = 0;
			if (effectiveConfig.currents === undefined) effectiveConfig.currents = 0;
			Log.info(`${this.name}: Profil Raspberry Pi appliqué (sharp=${effectiveConfig.sharp}, winds=${effectiveConfig.winds}, waves=${effectiveConfig.waves}, currents=${effectiveConfig.currents}).`);
		}

		// 3. Construction de l'URL via LivexUrl
		try {
			this.url = LivexUrl.livexUrl(effectiveConfig, globalThis.config);
		} catch (e) {
			this.error = e && e.message ? e.message : String(e);
			Log.error(`${this.name}: ${this.error}`);
			return;
		}

		// 4. Rechargement automatique si la connexion réseau revient
		this.onOnline = () => {
			Log.info(`${this.name}: Connexion réseau rétablie, rechargement du globe.`);
			this.reload();
		};
		window.addEventListener("online", this.onOnline);

		// 5. Rechargement périodique (minimum 60s)
		if (this.config.reloadInterval > 0) {
			const interval = Math.max(this.config.reloadInterval, 60 * 1000);
			this.reloadTimer = setInterval(() => this.reload(), interval);
		}
	},

	getDom() {
		if (this.globe) return this.globe;

		const globe = document.createElement("div");
		globe.className = "livex-globe";
		globe.style.position = globe.style.position || "relative";

		if (this.error) {
			globe.classList.add("livex-error", "small", "dimmed");
			globe.textContent = `MMM-LiveX: ${this.error}`;
			this.globe = globe;
			return globe;
		}

		const width = typeof LivexUrl.cssLength === "function"
			? LivexUrl.cssLength(this.config.width)
			: this.config.width;
		const height = typeof LivexUrl.cssLength === "function"
			? LivexUrl.cssLength(this.config.height)
			: this.config.height;

		if (width) globe.style.width = width;
		if (height) {
			globe.style.height = height;
		} else if (typeof LivexUrl.aspectRatio === "function") {
			globe.style.aspectRatio = LivexUrl.aspectRatio(this.config.aspectRatio);
		}

		if (this.config.interactive === false) {
			globe.classList.add("livex-still");
		}

		// Indicateur discret de chargement
		const statusEl = document.createElement("div");
		statusEl.className = "livex-status xsmall dimmed";
		statusEl.textContent = "Chargement de livex.earth...";
		statusEl.style.position = "absolute";
		statusEl.style.inset = "0";
		statusEl.style.display = "flex";
		statusEl.style.alignItems = "center";
		statusEl.style.justifyContent = "center";
		statusEl.style.pointerEvents = "none";
		globe.append(statusEl);
		this.statusEl = statusEl;

		const iframe = document.createElement("iframe");
		iframe.title = "livex.earth";
		iframe.allow = "fullscreen";
		iframe.referrerPolicy = "no-referrer";
		iframe.style.width = "100%";
		iframe.style.height = "100%";
		iframe.style.border = "0";

		iframe.addEventListener("load", () => {
			if (!this.unloaded && this.statusEl && iframe.src && iframe.src !== "about:blank") {
				this.statusEl.style.display = "none";
			}
		});

		iframe.addEventListener("error", () => {
			if (this.statusEl) {
				this.statusEl.textContent = "MMM-LiveX: Erreur de chargement";
				this.statusEl.style.display = "flex";
			}
		});

		iframe.src = this.url;
		globe.append(iframe);

		this.globe = globe;
		this.iframe = iframe;
		return globe;
	},

	/**
	 * Force un vrai rechargement de l'iframe (évite le no-op sur une URL identique).
	 */
	reload() {
		if (!this.iframe || this.unloaded || !this.url) return;

		if (this.statusEl) {
			this.statusEl.textContent = "Rechargement de livex.earth...";
			this.statusEl.style.display = "flex";
		}

		this.iframe.src = "about:blank";
		setTimeout(() => {
			if (!this.unloaded && this.iframe && this.url) {
				this.iframe.src = this.url;
			}
		}, 100);
	},

	suspend() {
		if (!this.iframe || !this.config.unloadWhenHidden) return;

		clearTimeout(this.unloadTimer);
		const delay = Math.max(Number(this.config.unloadDelay) || 0, 0);

		this.unloadTimer = setTimeout(() => {
			this.unloaded = true;
			if (this.iframe) {
				this.iframe.src = "about:blank";
			}
		}, delay);
	},

	resume() {
		clearTimeout(this.unloadTimer);
		if (!this.iframe || !this.unloaded || !this.url) return;

		this.unloaded = false;
		if (this.statusEl) {
			this.statusEl.textContent = "Chargement de livex.earth...";
			this.statusEl.style.display = "flex";
		}
		this.iframe.src = this.url;
	},

	stop() {
		clearTimeout(this.unloadTimer);
		clearInterval(this.reloadTimer);
		if (this.onOnline) {
			window.removeEventListener("online", this.onOnline);
		}
	},

	_getWebGL2Context() {
		try {
			const canvas = document.createElement("canvas");
			return canvas.getContext("webgl2") || null;
		} catch (e) {
			return null;
		}
	},

	_isRaspberryPi() {
		const platform = (typeof navigator !== "undefined" && navigator.platform) ? navigator.platform : "";
		const ua = (typeof navigator !== "undefined" && navigator.userAgent) ? navigator.userAgent : "";
		return /Linux\s+(armv|aarch64)/i.test(platform) || /Linux.*(armv6l|armv7l|aarch64)/i.test(ua);
	}
});
