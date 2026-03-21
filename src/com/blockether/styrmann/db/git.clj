(ns com.blockether.styrmann.db.git
  "Datalevin persistence for git entities: repo, author, branch, worktree, commit."
  (:require
   [datalevin.core :as d])
  (:import
   [java.util UUID]))

;; -- Pull patterns -----------------------------------------------------------

(def ^:private author-pull
  [:git.author/id
   :git.author/name
   :git.author/email])

(def ^:private commit-pull
  [:git.commit/id
   :git.commit/sha
   :git.commit/message
   :git.commit/authored-at
   {:git.commit/author author-pull}
   {:git.commit/parent [:git.commit/id :git.commit/sha]}])

(def ^:private branch-pull
  [:git.branch/id
   :git.branch/name
   :git.branch/remote?
   :git.branch/created-at
   {:git.branch/head commit-pull}])

(def ^:private worktree-pull
  [:git.worktree/id
   :git.worktree/path
   :git.worktree/main?
   :git.worktree/created-at
   {:git.worktree/branch branch-pull}])

(def ^:private repo-pull
  [:git.repo/id
   :git.repo/origin-url
   :git.repo/default-branch
   :git.repo/stats-edn
   :git.repo/knowledge-edn
   :git.repo/created-at])

;; -- Author ------------------------------------------------------------------

(defn find-author
  "Fetch a git author by UUID.

   Params:
   `conn` - Datalevin connection.
   `author-id` - UUID.

   Returns:
   Author map or nil."
  [conn author-id]
  (d/pull (d/db conn) author-pull [:git.author/id author-id]))

(defn find-author-by-email
  "Fetch a git author by email.

   Params:
   `conn` - Datalevin connection.
   `email` - String.

   Returns:
   Author map or nil."
  [conn email]
  (d/pull (d/db conn) author-pull [:git.author/email email]))

(defn upsert-author!
  "Upsert a git author by email. If an author with this email exists,
   the name is updated; otherwise a new entity is created.

   Params:
   `conn` - Datalevin connection.
   `attrs` - Map with `:name` and `:email`.

   Returns:
   Author map."
  [conn {:keys [name email]}]
  (let [existing (find-author-by-email conn email)
        author-id (or (:git.author/id existing) (UUID/randomUUID))]
    (d/transact! conn [{:git.author/id    author-id
                        :git.author/name  name
                        :git.author/email email}])
    (find-author conn author-id)))

;; -- Repo --------------------------------------------------------------------

(defn find-repo
  "Fetch a git repo by UUID.

   Params:
   `conn` - Datalevin connection.
   `repo-id` - UUID.

   Returns:
   Repo map or nil."
  [conn repo-id]
  (d/pull (d/db conn) repo-pull [:git.repo/id repo-id]))

(defn create-repo!
  "Persist a new git repo.

   Params:
   `conn` - Datalevin connection.
   `attrs` - Map with `:workspace-id`, `:origin-url`, and `:default-branch`.

   Returns:
   Repo map."
  [conn {:keys [workspace-id origin-url default-branch]}]
  (let [repo-id (UUID/randomUUID)]
    (d/transact! conn [{:git.repo/id             repo-id
                        :git.repo/workspace      [:workspace/id workspace-id]
                        :git.repo/origin-url     origin-url
                        :git.repo/default-branch default-branch
                        :git.repo/created-at     (java.util.Date.)}])
    (find-repo conn repo-id)))

;; -- Branch ------------------------------------------------------------------

(defn find-branch
  "Fetch a git branch by UUID.

   Params:
   `conn` - Datalevin connection.
   `branch-id` - UUID.

   Returns:
   Branch map or nil."
  [conn branch-id]
  (d/pull (d/db conn) branch-pull [:git.branch/id branch-id]))

(defn create-branch!
  "Persist a new git branch.

   Params:
   `conn` - Datalevin connection.
   `attrs` - Map with `:repo-id`, `:name`, and optional `:remote?`.

   Returns:
   Branch map."
  [conn {:keys [repo-id name remote?]}]
  (let [branch-id (UUID/randomUUID)]
    (d/transact! conn [{:git.branch/id         branch-id
                        :git.branch/repo       [:git.repo/id repo-id]
                        :git.branch/name       name
                        :git.branch/remote?    (boolean remote?)
                        :git.branch/created-at (java.util.Date.)}])
    (find-branch conn branch-id)))

(defn update-branch-head!
  "Point a branch at a new head commit.

   Params:
   `conn` - Datalevin connection.
   `branch-id` - UUID.
   `commit-id` - UUID. The new head commit.

   Returns:
   Updated branch map."
  [conn branch-id commit-id]
  (d/transact! conn [{:db/id             [:git.branch/id branch-id]
                      :git.branch/head   [:git.commit/id commit-id]}])
  (find-branch conn branch-id))

;; -- Worktree ----------------------------------------------------------------

(defn find-worktree
  "Fetch a git worktree by UUID.

   Params:
   `conn` - Datalevin connection.
   `worktree-id` - UUID.

   Returns:
   Worktree map or nil."
  [conn worktree-id]
  (d/pull (d/db conn) worktree-pull [:git.worktree/id worktree-id]))

(defn create-worktree!
  "Persist a new git worktree.

   Params:
   `conn` - Datalevin connection.
   `attrs` - Map with `:repo-id`, `:path`, `:branch-id`, and `:main?`.

   Returns:
   Worktree map."
  [conn {:keys [repo-id path branch-id main?]}]
  (let [worktree-id (UUID/randomUUID)]
    (d/transact! conn [{:git.worktree/id         worktree-id
                        :git.worktree/repo       [:git.repo/id repo-id]
                        :git.worktree/path       path
                        :git.worktree/branch     [:git.branch/id branch-id]
                        :git.worktree/main?      (boolean main?)
                        :git.worktree/created-at (java.util.Date.)}])
    (find-worktree conn worktree-id)))

;; -- Commit ------------------------------------------------------------------

(defn find-commit
  "Fetch a git commit by UUID.

   Params:
   `conn` - Datalevin connection.
   `commit-id` - UUID.

   Returns:
   Commit map or nil."
  [conn commit-id]
  (d/pull (d/db conn) commit-pull [:git.commit/id commit-id]))

(defn find-commit-by-sha
  "Fetch a git commit by its SHA.

   Params:
   `conn` - Datalevin connection.
   `sha` - String. Full 40-char hex SHA.

   Returns:
   Commit map or nil."
  [conn sha]
  (d/pull (d/db conn) commit-pull [:git.commit/sha sha]))

(defn create-commit!
  "Persist a new git commit.

   Params:
   `conn` - Datalevin connection.
   `attrs` - Map with `:repo-id`, `:sha`, `:message`, `:author-id`,
             `:authored-at`, and optional `:parent-ids` (vector of UUIDs).

   Returns:
   Commit map."
  [conn {:keys [repo-id sha message author-id authored-at parent-ids]}]
  (let [commit-id (UUID/randomUUID)
        tx-data (cond-> {:git.commit/id          commit-id
                         :git.commit/repo        [:git.repo/id repo-id]
                         :git.commit/sha         sha
                         :git.commit/message     message
                         :git.commit/author      [:git.author/id author-id]
                         :git.commit/authored-at authored-at}
                  (seq parent-ids)
                  (assoc :git.commit/parent (mapv #(vector :git.commit/id %) parent-ids)))]
    (d/transact! conn [tx-data])
    (find-commit conn commit-id)))

(defn find-repo-by-workspace
  "Fetch a git repo by workspace UUID.

   Params:
   `conn` - Datalevin connection.
   `workspace-id` - UUID.

   Returns:
   Repo map or nil."
  [conn workspace-id]
  (let [result (d/q '[:find ?repo-id
                       :in $ ?ws-id
                       :where
                       [?repo :git.repo/workspace [:workspace/id ?ws-id]]
                       [?repo :git.repo/id ?repo-id]]
                     (d/db conn)
                     workspace-id)]
    (when (seq result)
      (find-repo conn (ffirst result)))))

(defn list-branches-by-repo
  "List branches for a repo.

   Params:
   `conn` - Datalevin connection.
   `repo-id` - UUID.

   Returns:
   Vector of branch maps."
  [conn repo-id]
  (->> (d/q '[:find ?branch-id
              :in $ ?repo-id
              :where
              [?repo :git.repo/id ?repo-id]
              [?branch :git.branch/repo ?repo]
              [?branch :git.branch/id ?branch-id]]
            (d/db conn)
            repo-id)
       (map first)
       (map #(find-branch conn %))
       (sort-by :git.branch/name)
       vec))

(defn list-commits-by-repo
  "List commits for a repo, most recent first.

   Params:
   `conn` - Datalevin connection.
   `repo-id` - UUID.

   Returns:
   Vector of commit maps."
  [conn repo-id]
  (->> (d/q '[:find ?commit-id
              :in $ ?repo-id
              :where
              [?repo :git.repo/id ?repo-id]
              [?commit :git.commit/repo ?repo]
              [?commit :git.commit/id ?commit-id]]
            (d/db conn)
            repo-id)
       (map first)
       (map #(find-commit conn %))
       (sort-by :git.commit/authored-at #(compare %2 %1))
       vec))
