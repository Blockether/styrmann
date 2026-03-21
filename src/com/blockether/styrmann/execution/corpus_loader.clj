(ns com.blockether.styrmann.execution.corpus-loader
  "Helpers for preparing corpus repositories and mock git histories."
  (:require
   [clojure.java.io :as io]
   [clojure.java.shell :as sh]
   [clojure.string :as str]))

(defn corpus-root
  "Return absolute corpus root path."
  []
  (.getAbsolutePath (io/file "corpus")))

(defn list-projects
  "List corpus project directory names."
  []
  (let [root (io/file (corpus-root))]
    (->> (.listFiles root)
         (filter #(.isDirectory %))
         (map #(.getName %))
         sort
         vec)))

(defn- run-git! [repo-path & args]
  (let [result (apply sh/sh "git" "-C" repo-path args)]
    (when-not (zero? (:exit result))
      (throw (ex-info "Git command failed"
                      {:repo-path repo-path
                       :args args
                       :exit (:exit result)
                       :err (:err result)
                       :out (:out result)})))
    (str/trim (:out result))))

(defn copy-project!
  "Copy one project from corpus into repo-path/<project-name>."
  [repo-path project-name]
  (let [root (io/file (corpus-root) project-name)]
    (when-not (.exists root)
      (throw (ex-info "Corpus project not found" {:project-name project-name :root (.getAbsolutePath root)})))
    (doseq [file (file-seq root)
            :when (.isFile file)]
      (let [relative (.substring (.getPath file) (inc (count (.getPath root))))
            target (io/file repo-path project-name relative)]
        (.mkdirs (.getParentFile target))
        (spit target (slurp file))))))

(defn init-repo!
  "Initialize git repo with deterministic test identity on main branch."
  [repo-path]
  (.mkdirs (io/file repo-path))
  (run-git! repo-path "init" "--initial-branch" "main")
  (run-git! repo-path "config" "user.name" "Corpus Tester")
  (run-git! repo-path "config" "user.email" "corpus@example.com")
  repo-path)

(defn commit-all!
  "Stage all files and create one commit, returning commit SHA."
  [repo-path message]
  (run-git! repo-path "add" ".")
  (run-git! repo-path "commit" "-m" message)
  (run-git! repo-path "rev-parse" "HEAD"))

(defn seed-history!
  "Create a linear mock history by copying corpus projects commit-by-commit.

   Params:
   `repo-path` - local git repo path.
   `steps` - vector of maps like {:project-name lein-hello-world :message feat-add-fixture}.

   Returns vector of commit SHAs in commit order."
  [repo-path steps]
  (mapv (fn [{:keys [project-name message]}]
          (copy-project! repo-path project-name)
          (commit-all! repo-path message))
        steps))

(defn list-profiles
  "List available synthetic git history profiles."
  []
  [:linear :branch-merge :hotfix-merge :comprehensive-broken :broken-then-fix :fix-regression])

(defn- append-line! [path line]
  (spit path (str (slurp path) "\n" line)))

(defn- write-file! [path content]
  (.mkdirs (.getParentFile (io/file path)))
  (spit path content))

(defn seed-profile-history!
  "Seed one predefined git history profile into an initialized repository.

   Profiles:
   - :linear       -> three linear commits (lein, deps, algorithms)
   - :branch-merge -> feature branch merged into main
   - :hotfix-merge -> hotfix branch merged into main
   - :comprehensive-broken -> comprehensive Clojure project plus intentionally broken examples
   - :broken-then-fix -> broken corpus commit followed by repair commit
   - :fix-regression -> broken commit, fix commit, then regression reintroducing bug

   Returns vector of commit SHAs in creation order."
  [repo-path profile]
  (case profile
    :linear
    (seed-history! repo-path
                   [{:project-name "lein-hello-world" :message "feat: add lein hello world corpus"}
                    {:project-name "deps-hello-world" :message "feat: add deps hello world corpus"}
                    {:project-name "clj-algorithms" :message "feat: add advanced clojure algorithms corpus"}])

    :branch-merge
    (let [c1 (do (copy-project! repo-path "lein-hello-world")
                 (commit-all! repo-path "feat: add lein hello world corpus"))
          _  (run-git! repo-path "checkout" "-b" "feature/deps")
          c2 (do (copy-project! repo-path "deps-hello-world")
                 (commit-all! repo-path "feat: add deps hello world corpus"))
          _  (run-git! repo-path "checkout" "main")
          c3 (do (copy-project! repo-path "clj-algorithms")
                 (commit-all! repo-path "feat: add advanced clojure algorithms corpus"))
          _  (run-git! repo-path "merge" "--no-ff" "feature/deps" "-m" "merge: feature/deps")
          c4 (run-git! repo-path "rev-parse" "HEAD")]
      [c1 c2 c3 c4])

    :hotfix-merge
    (let [c1 (do (copy-project! repo-path "lein-hello-world")
                 (commit-all! repo-path "feat: add lein hello world corpus"))
          c2 (do (copy-project! repo-path "deps-hello-world")
                 (commit-all! repo-path "feat: add deps hello world corpus"))
          _  (run-git! repo-path "checkout" "-b" "hotfix/readme")
          _  (append-line! (str repo-path "/lein-hello-world/src/lein_hello_world/core.clj")
                           "; hotfix marker")
          c3 (commit-all! repo-path "fix: patch lein hello world output")
          _  (run-git! repo-path "checkout" "main")
          _  (run-git! repo-path "merge" "--no-ff" "hotfix/readme" "-m" "merge: hotfix/readme")
          c4 (run-git! repo-path "rev-parse" "HEAD")
          c5 (do (copy-project! repo-path "clj-algorithms")
                 (commit-all! repo-path "feat: add advanced clojure algorithms corpus"))]
      [c1 c2 c3 c4 c5])

    :comprehensive-broken
    (seed-history! repo-path
                   [{:project-name "clj-comprehensive"
                     :message "feat: add comprehensive clojure corpus"}
                    {:project-name "clj-broken-examples"
                     :message "test: add broken clojure examples corpus"}
                    {:project-name "clj-algorithms"
                     :message "feat: add advanced clojure algorithms corpus"}])

    :broken-then-fix
    (let [c1 (do (copy-project! repo-path "clj-broken-examples")
                 (commit-all! repo-path "test: add broken clojure examples corpus"))
          _  (write-file! (str repo-path "/clj-broken-examples/src/broken/logic_error.clj")
                          (str "(ns broken.logic-error)\n\n"
                               "(defn average\n"
                               "  [xs]\n"
                               "  (if (seq xs)\n"
                               "    (/ (reduce + xs) (count xs))\n"
                               "    0))\n\n"
                               "(defn status-label\n"
                               "  [status]\n"
                               "  (case status\n"
                               "    :open \"Open\"\n"
                               "    :in-progress \"In Progress\"\n"
                               "    :done \"Done\"\n"
                               "    \"Unknown\"))\n"))
          _  (write-file! (str repo-path "/clj-broken-examples/src/broken/syntax_error.clj")
                          (str "(ns broken.syntax-error)\n\n"
                               "(defn broken-fn [x]\n"
                               "  (+ x 1))\n"))
          c2 (commit-all! repo-path "fix: repair broken clojure examples")
          c3 (do (copy-project! repo-path "clj-comprehensive")
                 (commit-all! repo-path "feat: add comprehensive clojure corpus"))]
      [c1 c2 c3])

    :fix-regression
    (let [c1 (do (copy-project! repo-path "clj-broken-examples")
                 (commit-all! repo-path "test: add broken clojure examples corpus"))
          _  (write-file! (str repo-path "/clj-broken-examples/src/broken/logic_error.clj")
                          (str "(ns broken.logic-error)\n\n"
                               "(defn average\n"
                               "  [xs]\n"
                               "  (if (seq xs)\n"
                               "    (/ (reduce + xs) (count xs))\n"
                               "    0))\n\n"
                               "(defn status-label\n"
                               "  [status]\n"
                               "  (case status\n"
                               "    :open \"Open\"\n"
                               "    :in-progress \"In Progress\"\n"
                               "    :done \"Done\"\n"
                               "    \"Unknown\"))\n"))
          _  (write-file! (str repo-path "/clj-broken-examples/src/broken/syntax_error.clj")
                          (str "(ns broken.syntax-error)\n\n"
                               "(defn broken-fn [x]\n"
                               "  (+ x 1))\n"))
          c2 (commit-all! repo-path "fix: repair broken clojure examples")
          _  (write-file! (str repo-path "/clj-broken-examples/src/broken/logic_error.clj")
                          (str "(ns broken.logic-error)\n\n"
                               "(defn average\n"
                               "  [xs]\n"
                               "  (if (seq xs)\n"
                               "    (/ (reduce + xs) (inc (count xs)))\n"
                               "    0))\n\n"
                               "(defn status-label\n"
                               "  [status]\n"
                               "  (case status\n"
                               "    :open \"Open\"\n"
                               "    :in-progress \"In Progress\"\n"
                               "    :done \"In Progress\"\n"
                               "    \"Unknown\"))\n"))
          c3 (commit-all! repo-path "test: reintroduce logic regression")
          c4 (do (copy-project! repo-path "clj-comprehensive")
                 (commit-all! repo-path "feat: add comprehensive clojure corpus"))]
      [c1 c2 c3 c4])

    (throw (ex-info "Unknown corpus history profile"
                    {:profile profile
                     :available (list-profiles)}))))
