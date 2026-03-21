(ns user
  "Loaded automatically when the REPL starts with the :dev alias.
   Boots nREPL + Ring/Jetty + Datalevin.
   Provides test runners, docstring validation, and test scaffolding."
  (:require
   [clj-reload.core :as reload]
   [clojure.string :as str]
   [com.blockether.styrmann.app :as app]
   [com.blockether.styrmann.bootstrap :as bootstrap]
   [com.blockether.styrmann.db.core :as db]
   [nrepl.server :as nrepl]
   [ring.adapter.jetty :as jetty]
   [taoensso.telemere :as t]))

;; -- logging -----------------------------------------------------------------

;; Dev: console only (default handler), debug level
(t/set-min-level! :debug)

;; -- state -------------------------------------------------------------------

(defonce ^:private !nrepl (atom nil))
(defonce ^:private !jetty (atom nil))

;; -- lifecycle ---------------------------------------------------------------

(defn start
  "Start nREPL + Jetty + Datalevin. Idempotent."
  ([] (start {}))
  ([{:keys [nrepl-port http-port db-path]
     :or   {nrepl-port 7888
            http-port  3000
            db-path    "data/styrmann"}}]
   (db/start! db-path)
   (bootstrap/ensure-from-git! (db/conn))
   (when-not @!nrepl
     (let [srv (nrepl/start-server :port nrepl-port)]
       (reset! !nrepl srv)
       (spit ".nrepl-port" (str nrepl-port))
       (t/log! :info ["nREPL listening" {:port nrepl-port}])))
   (when-not @!jetty
     (let [srv (jetty/run-jetty #'app/app {:port http-port :join? false})]
       (reset! !jetty srv)
       (t/log! :info ["HTTP listening" {:port http-port}])))))

(defn stop
  "Stop nREPL + Jetty + Datalevin."
  []
  (when-let [srv @!jetty]
    (.stop srv)
    (reset! !jetty nil)
    (t/log! :info "HTTP stopped"))
  (when-let [srv @!nrepl]
    (nrepl/stop-server srv)
    (reset! !nrepl nil)
    (t/log! :info "nREPL stopped"))
  (db/stop!))

(defn reset
  "Reload changed namespaces via clj-reload. No server restart needed."
  []
  (reload/reload))

;; =============================================================================
;; Docstring Validation (from unbound)
;; =============================================================================

(def ^:private SECTION_MARKERS
  {:params       #"(?i)^\s*(params|parameters|arguments|args):\s*$"
   :examples     #"(?i)^\s*(examples?|usage):\s*$"
   :returns      #"(?i)^\s*(returns?|output):\s*$"
   :throws       #"(?i)^\s*(throws?|exceptions?|errors?):\s*$"
   :see-also     #"(?i)^\s*(see[ -]?also|related):\s*$"})

(defn- find-section-start-indices [lines]
  (reduce-kv
   (fn [acc idx line]
     (reduce-kv
      (fn [acc' section pattern]
        (if (re-matches pattern line) (assoc acc' section idx) acc'))
      acc SECTION_MARKERS))
   {} (vec lines)))

(defn- extract-summary-text [lines section-indices]
  (let [first-idx (when (seq section-indices) (apply min (vals section-indices)))
        summary-lines (if first-idx (take first-idx lines) lines)]
    (when (seq summary-lines) (str/trim (str/join "\n" summary-lines)))))

(defn- parse-docstring-sections [docstring]
  (when docstring
    (let [lines (str/split-lines docstring)
          indices (find-section-start-indices lines)]
      {:summary  (extract-summary-text lines indices)
       :sections (set (keys indices))
       :raw      docstring})))

(defn- has-parameters? [fn-var]
  (boolean (some seq (:arglists (meta fn-var)))))

(defn- validate-fn-docstring [fn-var]
  (let [m (meta fn-var)
        docstring (:doc m)
        fn-name (:name m)
        has-params (has-parameters? fn-var)]
    (if-not docstring
      {:fn-name fn-name :valid? false :errors ["Missing docstring"] :warnings []}
      (let [{:keys [summary sections]} (parse-docstring-sections docstring)
            errors (cond-> []
                     (str/blank? summary)       (conj "Missing summary")
                     (and has-params (not (contains? sections :params))) (conj "Missing Params section")
                     (not (contains? sections :returns)) (conj "Missing Returns section"))
            warnings (cond-> []
                       (not (contains? sections :examples)) (conj "Consider adding Examples section"))]
        {:fn-name fn-name :valid? (empty? errors) :errors errors :warnings warnings}))))

(defn- get-public-functions [ns-sym]
  (require ns-sym)
  (->> (ns-publics ns-sym) vals (filter #(fn? (deref %)))))

(defn check-docstrings
  "Validates docstring format for all public functions in a namespace.

   Params:
   `ns-sym` - Symbol. The namespace to validate.

   Returns:
   Map with :total, :valid, :invalid counts and :results vector."
  [ns-sym]
  (let [fn-vars (get-public-functions ns-sym)
        results (mapv validate-fn-docstring fn-vars)
        valid-count (count (filter :valid? results))
        invalid-count (- (count results) valid-count)]
    (println)
    (println (str "=== Docstring Report: " ns-sym " ==="))
    (println (str "Total: " (count results) " | Valid: " valid-count " | Invalid: " invalid-count))
    (println)
    (doseq [{:keys [fn-name valid? errors warnings]} results]
      (cond
        (not valid?)
        (do (println (str "  " fn-name " - FAIL"))
            (doseq [e errors]   (println (str "    ERROR: " e)))
            (doseq [w warnings] (println (str "    WARN: " w))))
        (seq warnings)
        (do (println (str "  " fn-name " - OK (warnings)"))
            (doseq [w warnings] (println (str "    WARN: " w))))))
    (println)
    (if (zero? invalid-count)
      (println "All docstrings valid!")
      (println (str invalid-count " function(s) need docstring fixes.")))
    {:namespace ns-sym :total (count results) :valid valid-count :invalid invalid-count :results results}))

;; =============================================================================
;; Test Coverage Validation (from unbound)
;; =============================================================================

(defn- source-ns->test-ns [ns-sym]
  (symbol (str (name ns-sym) "-test")))

(defn- fn-name->test-name [fn-name]
  (symbol (str (name fn-name) "-test")))

(defn- test-ns-exists? [test-ns-sym]
  (try (require test-ns-sym) true
       (catch java.io.FileNotFoundException _ false)))

(defn- find-test-var [test-ns-sym fn-name]
  (get (ns-publics test-ns-sym) (fn-name->test-name fn-name)))

(defn check-test-coverage
  "Validates that each public function has a corresponding test.

   Params:
   `ns-sym` - Symbol. The source namespace to check.

   Returns:
   Map with :total, :covered, :missing counts and :results vector."
  [ns-sym]
  (let [test-ns-sym (source-ns->test-ns ns-sym)
        test-ns-exists (test-ns-exists? test-ns-sym)
        fn-vars (get-public-functions ns-sym)
        results (mapv (fn [v]
                        (let [fn-name (:name (meta v))]
                          {:fn-name fn-name
                           :has-test? (and test-ns-exists (some? (find-test-var test-ns-sym fn-name)))}))
                      fn-vars)
        covered (count (filter :has-test? results))
        missing (- (count results) covered)]
    (println)
    (println (str "=== Test Coverage: " ns-sym " ==="))
    (println (str "Test ns: " test-ns-sym (if test-ns-exists " (found)" " (NOT FOUND)")))
    (println (str "Total: " (count results) " | Covered: " covered " | Missing: " missing))
    (println)
    (doseq [{:keys [fn-name has-test?]} results]
      (println (str "  " fn-name (if has-test? " - OK" " - MISSING"))))
    {:namespace ns-sym :total (count results) :covered covered :missing missing}))

(defn check-all
  "Runs docstring + test coverage checks on a namespace.

   Params:
   `ns-sym` - Symbol. The namespace to validate.

   Returns:
   Map with :docstrings and :test-coverage sub-reports."
  [ns-sym]
  (let [ds (check-docstrings ns-sym)
        tc (check-test-coverage ns-sym)]
    (println)
    (println "=== Summary ===")
    (println (str "Docstrings: " (:valid ds) "/" (:total ds) " valid"))
    (println (str "Tests: " (:covered tc) "/" (:total tc) " covered"))
    {:docstrings ds :test-coverage tc}))

;; =============================================================================
;; Test Running (Lazytest)
;; =============================================================================

(defn- ensure-lazytest! []
  (try (require 'lazytest.repl) true
       (catch java.io.FileNotFoundException _
         (throw (ex-info "Lazytest not on classpath. Start with: clj -M:dev:test" {})))))

(defn- styrmann-source-namespaces []
  (->> (all-ns)
       (map ns-name)
       (filter #(str/starts-with? (name %) "com.blockether.styrmann."))
       (remove #(str/ends-with? (name %) "-test"))
       (sort)))

(defn run-tests
  "Run tests for a specific test namespace.

   Params:
   `ns-sym` - Symbol. Test namespace (e.g. 'com.blockether.styrmann.domain.ticket-test).

   Returns:
   Lazytest result."
  ([] (run-tests nil))
  ([ns-sym]
   (ensure-lazytest!)
   (when-let [source-ns (when (and ns-sym (str/ends-with? (name ns-sym) "-test"))
                          (symbol (subs (name ns-sym) 0 (- (count (name ns-sym)) 5))))]
     (try (require source-ns :reload) (catch java.io.FileNotFoundException _)))
   (when ns-sym (try (require ns-sym :reload) (catch java.io.FileNotFoundException _)))
   (if ns-sym
     ((requiring-resolve 'lazytest.repl/run-tests) ns-sym)
     ((requiring-resolve 'lazytest.main/-main)))))

(defn run-test
  "Run a single test var. Accepts test var or implementation var.

   Params:
   `fn-var` - Var. Either #'ns-test/fn-test or #'ns/fn (auto-finds test).

   Returns:
   Lazytest result."
  [fn-var]
  (ensure-lazytest!)
  (let [fn-meta (meta fn-var)
        fn-name (:name fn-meta)
        var-ns (ns-name (:ns fn-meta))
        test-var? (str/ends-with? (name fn-name) "-test")
        test-var (if test-var?
                   fn-var
                   (let [test-ns (source-ns->test-ns var-ns)]
                     (try (require test-ns :reload)
                          (find-test-var test-ns fn-name)
                          (catch java.io.FileNotFoundException _ nil))))]
    (when-not test-var
      (throw (ex-info (str "Test not found for: " fn-name)
                      {:fn-name fn-name :source-ns var-ns
                       :expected (str (source-ns->test-ns var-ns) "/" (fn-name->test-name fn-name))})))
    (when test-var?
      (when-let [source-ns (when (str/ends-with? (name var-ns) "-test")
                             (symbol (subs (name var-ns) 0 (- (count (name var-ns)) 5))))]
        (try (require source-ns :reload) (catch java.io.FileNotFoundException _))))
    (let [test-ns (ns-name (:ns (meta test-var)))]
      (require test-ns :reload)
      ((resolve 'lazytest.repl/run-test-var) test-var))))

(defn run-all-tests
  "Run all tests for loaded styrmann namespaces.

   Returns:
   Lazytest result."
  []
  (ensure-lazytest!)
  (println "Reloading source namespaces...")
  (let [source-nss (styrmann-source-namespaces)]
    (doseq [ns-sym source-nss] (require ns-sym :reload))
    (println (str "  Reloaded: " (count source-nss) " namespaces"))
    (let [test-nss (reduce (fn [acc ns-sym]
                             (let [tns (source-ns->test-ns ns-sym)]
                               (try (require tns :reload) (conj acc tns)
                                    (catch java.io.FileNotFoundException _ acc))))
                           [] source-nss)]
      (if (seq test-nss)
        (do (println (str "  Running: " (count test-nss) " test namespaces"))
            ((resolve 'lazytest.repl/run-tests) test-nss))
        (println "  No test namespaces found.")))))

;; =============================================================================
;; Test Generation (from unbound)
;; =============================================================================

(defn- ns-sym->test-path [ns-sym]
  (str "test/" (-> (name ns-sym) (str/replace "." "/") (str/replace "-" "_")) "_test.clj"))

(defn gen-test
  "Generate a test scaffold for a function.

   Params:
   `fn-var` - Var. The function to generate a test for.

   Returns:
   Map with :test-file, :test-name, :created?, :appended?."
  [fn-var]
  (let [fn-var (if (var? fn-var) fn-var (resolve fn-var))
        fn-meta (meta fn-var)
        fn-name (:name fn-meta)
        source-ns (ns-name (:ns fn-meta))
        test-ns (source-ns->test-ns source-ns)
        test-path (ns-sym->test-path source-ns)
        test-name (fn-name->test-name fn-name)
        scaffold (str "(defdescribe " test-name "\n"
                      "  (it \"does something\"\n"
                      "    (expect (= :expected :expected))))\n")
        file-exists? (.exists (java.io.File. test-path))]
    (when file-exists?
      (when (str/includes? (slurp test-path) (str "(defdescribe " test-name))
        (println (str "Test " test-name " already exists in " test-path))
        (throw (ex-info (str "Test already exists: " test-name) {:test-name test-name}))))
    (.mkdirs (.getParentFile (java.io.File. test-path)))
    (if file-exists?
      (do (spit test-path (str "\n" scaffold) :append true)
          (println (str "Appended " test-name " to " test-path))
          {:test-file test-path :test-name test-name :created? false :appended? true})
      (let [header (str "(ns " test-ns "\n"
                        "  (:require\n"
                        "   [lazytest.core :refer [defdescribe describe it expect expect-it\n"
                        "                          before after around before-each after-each]]\n"
                        "   [" source-ns " :as sut]))\n")]
        (spit test-path (str header "\n" scaffold))
        (println (str "Created " test-path " with " test-name))
        {:test-file test-path :test-name test-name :created? true :appended? false}))))

(defn scaffold-test-namespace
  "Generate test scaffolds for all untested public fns in a namespace.

   Params:
   `ns-sym` - Symbol. The source namespace.

   Returns:
   Map with counts of created and skipped scaffolds."
  [ns-sym]
  (require ns-sym)
  (let [test-ns-sym (source-ns->test-ns ns-sym)
        test-path (ns-sym->test-path ns-sym)
        fn-vars (get-public-functions ns-sym)
        file-exists? (.exists (java.io.File. test-path))
        test-loaded? (try (require test-ns-sym) true
                          (catch java.io.FileNotFoundException _ false))
        categorized (mapv (fn [v]
                            (let [fn-name (:name (meta v))
                                  exists? (or (and file-exists?
                                                   (str/includes? (slurp test-path) (str "(defdescribe " (fn-name->test-name fn-name))))
                                              (and test-loaded? (some? (find-test-var test-ns-sym fn-name))))]
                              {:fn-name fn-name :exists? exists?}))
                          fn-vars)
        to-create (filterv (complement :exists?) categorized)]
    (println (str "\n=== Scaffolding: " ns-sym " ==="))
    (println (str "Total: " (count fn-vars) " | To create: " (count to-create) " | Exist: " (count (filter :exists? categorized))))
    (when (seq to-create)
      (.mkdirs (.getParentFile (java.io.File. test-path)))
      (when-not file-exists?
        (spit test-path (str "(ns " test-ns-sym "\n"
                             "  (:require\n"
                             "   [lazytest.core :refer [defdescribe describe it expect expect-it\n"
                             "                          before after around before-each after-each]]\n"
                             "   [" ns-sym " :as sut]))\n")))
      (doseq [{:keys [fn-name]} to-create]
        (spit test-path (str "\n(defdescribe " (fn-name->test-name fn-name) "\n"
                             "  (it \"does something\"\n"
                             "    (expect (= :expected :expected))))\n")
              :append true)
        (println (str "  Created: " (fn-name->test-name fn-name)))))
    {:test-file test-path :created (count to-create) :skipped (- (count fn-vars) (count to-create))}))

;; -- clj-reload + clojure+ ---------------------------------------------------

(reload/init {:dirs ["src" "dev"]})
((requiring-resolve 'clojure+.hashp/install!))
((requiring-resolve 'clojure+.error/install!))

;; -- auto-start on load ------------------------------------------------------

(start {:nrepl-port (parse-long (or (System/getenv "NREPL_PORT") "7888"))
        :http-port  (parse-long (or (System/getenv "HTTP_PORT")  "3000"))
        :db-path    (or (System/getenv "DB_PATH") "data/styrmann")})
