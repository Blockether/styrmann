(ns com.blockether.styrmann.execution.git-ingestion
  "Git history ingestion for corpus and workspace repositories."
  (:require
   [clojure.java.shell :as sh]
   [clojure.string :as str]))

(def ^:private field-sep (char 31))

(defn- run-git! [repo-path & args]
  (let [args (vec args)
        [opts git-args] (if (map? (first args))
                          [(first args) (subvec args 1)]
                          [{} args])
        result (apply sh/sh "git" "-C" repo-path git-args)]
    (when-not (zero? (:exit result))
      (when-not (:allow-fail? opts)
        (throw (ex-info "Git command failed"
                        {:repo-path repo-path
                         :args git-args
                         :exit (:exit result)
                         :err (:err result)}))))
    (str/trim (:out result))))

(defn- parse-commit-line [line]
  (let [[sha parents author-name author-email authored-at message]
        (str/split line (re-pattern (str field-sep)))]
    {:sha sha
     :parent-shas (if (str/blank? parents) [] (str/split parents #" +"))
     :author-name author-name
     :author-email author-email
     :authored-at (java.util.Date/from (java.time.Instant/parse authored-at))
     :message message}))

(defn- list-commits [repo-path]
  (let [format-string (str "%H" field-sep "%P" field-sep "%an" field-sep "%ae" field-sep "%aI" field-sep "%s")
        output (run-git! repo-path "log" "--reverse" (str "--pretty=format:" format-string))]
    (if (str/blank? output)
      []
      (mapv parse-commit-line (str/split-lines output)))))

(defn- origin-url [repo-path]
  (let [url (run-git! repo-path {:allow-fail? true} "config" "--get" "remote.origin.url")]
    (if (str/blank? url) repo-path url)))

(defn- default-branch [repo-path]
  (let [head-ref (run-git! repo-path "symbolic-ref" "--short" "HEAD")]
    (if (str/blank? head-ref) "main" head-ref)))

(defn ingest-repo-history!
  "Ingest a repository's git history into Datalevin git entities.

   Params:
   `ctx` - Execution context map with :store/git-* callbacks.
   `workspace-id` - UUID. Target workspace.
   `repo-path` - String. Local filesystem path to git repository.

   Returns:
   Map with :repo, :branch, :worktree, and :commits."
  [ctx workspace-id repo-path]
  (let [commits (list-commits repo-path)
        repo ((:store/git-create-repo! ctx) {:workspace-id workspace-id
                                              :origin-url (origin-url repo-path)
                                              :default-branch (default-branch repo-path)})
        repo-id (:git.repo/id repo)
        sha->commit-id (volatile! {})
        created-commits
        (mapv (fn [{:keys [sha parent-shas author-name author-email authored-at message]}]
                (let [author ((:store/git-upsert-author! ctx) {:name author-name :email author-email})
                      parent-ids (mapv (fn [parent-sha]
                                         (or (@sha->commit-id parent-sha)
                                             (throw (ex-info "Parent commit missing from ingestion order"
                                                             {:sha sha :parent-sha parent-sha}))))
                                       parent-shas)
                      commit ((:store/git-create-commit! ctx) {:repo-id repo-id
                                                                :sha sha
                                                                :message message
                                                                :author-id (:git.author/id author)
                                                                :authored-at authored-at
                                                                :parent-ids parent-ids})]
                  (vswap! sha->commit-id assoc sha (:git.commit/id commit))
                  commit))
              commits)
        branch ((:store/git-create-branch! ctx) {:repo-id repo-id
                                                  :name (default-branch repo-path)
                                                  :remote? false})
        branch (if-let [head (last created-commits)]
                 ((:store/git-update-branch-head! ctx) (:git.branch/id branch) (:git.commit/id head))
                 branch)
        worktree ((:store/git-create-worktree! ctx) {:repo-id repo-id
                                                      :path repo-path
                                                      :branch-id (:git.branch/id branch)
                                                      :main? true})]
    {:repo repo
     :branch branch
     :worktree worktree
     :commits created-commits}))
