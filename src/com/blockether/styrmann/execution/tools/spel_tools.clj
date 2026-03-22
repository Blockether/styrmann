(ns com.blockether.styrmann.execution.tools.spel-tools
  "Spel browser automation tools and URL-to-markdown conversion."
  (:require
   [clojure.java.shell :as sh]
   [clojure.string :as str]))

(defn- run-cmd! [& args]
  (let [result (apply sh/sh args)]
    {:exit (:exit result)
     :out  (str/trim (:out result))
     :err  (str/trim (:err result))}))

(defn spel-snapshot
  "Take a Spel DOM snapshot of a URL, optionally scoped to a CSS selector.

   Opens the URL in the Spel browser then captures a structured snapshot
   including element positions, text content, and computed styles.

   Context: (unused)
   Params:  {:url \"https://...\" :selector \"body\"}
   Returns: {:ok? true :snapshot \"...snapshot text...\"}
            {:ok? false :error \"message\"}"
  [_ctx {:keys [url selector]}]
  (when (str/blank? url)
    (throw (ex-info "url is required" {})))
  (let [sel (or selector "body")
        {:keys [exit err]} (run-cmd! "spel" "open" url)
        open-ok? (zero? exit)]
    (if-not open-ok?
      {:ok? false :error (str "spel open failed: " err)}
      (let [{:keys [exit out err]} (run-cmd! "spel" "snapshot" "-s" sel)]
        (if (zero? exit)
          {:ok?      true
           :url      url
           :selector sel
           :snapshot out}
          {:ok?   false
           :error (str "spel snapshot failed: " err)})))))

(defn markdownify
  "Convert a URL's HTML content to plain markdown text.

   Fetches the page with curl and converts it to readable text using
   html2text (if available), falling back to lynx -dump.

   Context: (unused)
   Params:  {:url \"https://...\"}
   Returns: {:ok? true :markdown \"...text...\"}
            {:ok? false :error \"message\"}"
  [_ctx {:keys [url]}]
  (when (str/blank? url)
    (throw (ex-info "url is required" {})))
  ;; Try html2text first, then lynx as fallback
  (let [{:keys [exit out err]}
        (sh/sh "bash" "-c"
               (str "curl -sL " (pr-str url) " | html2text 2>/dev/null || "
                    "curl -sL " (pr-str url) " | lynx -dump -stdin 2>/dev/null"))]
    (if (zero? exit)
      {:ok?      true
       :url      url
       :markdown (str/trim out)}
      {:ok?   false
       :error (str "markdownify failed: " err)})))
