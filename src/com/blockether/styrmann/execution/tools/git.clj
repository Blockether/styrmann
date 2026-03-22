(ns com.blockether.styrmann.execution.tools.git
  "Tool functions for git repository operations.")

(defn repo-summary
  "Read git repository metadata and latest commit summary.

   Context: {:ctx ctx}
   Input:   {:workspace-id uuid-string}
   Output:  {:ok? true :repo {...} :branches [...] :recent-commits [...]}"
  [{:keys [ctx]} {:keys [workspace-id]}]
  (let [ws-id (if (string? workspace-id)
                (java.util.UUID/fromString workspace-id)
                workspace-id)
        workspace ((:store/find-workspace ctx) ws-id)]
    (if-not workspace
      {:ok? false :error (str "Workspace not found: " workspace-id)}
      (let [repo ((:store/git-find-repo-by-workspace ctx) ws-id)
            commits (when repo
                      ((:store/git-list-commits-by-repo ctx) (:git.repo/id repo)))
            branches (when repo
                       ((:store/git-list-branches-by-repo ctx) (:git.repo/id repo)))]
        {:ok? true
         :workspace {:name (:workspace/name workspace)
                     :repository (:workspace/repository workspace)}
         :repo (when repo
                 {:id (str (:git.repo/id repo))
                  :origin (:git.repo/origin-url repo)})
         :branch-count (count branches)
         :branches (mapv (fn [b]
                           {:name (:git.branch/name b)
                            :head (some-> b :git.branch/head :git.commit/sha)})
                         (take 10 branches))
         :commit-count (count commits)
         :recent-commits (mapv (fn [c]
                                 {:sha (:git.commit/sha c)
                                  :message (:git.commit/message c)
                                  :author (some-> c :git.commit/author :git.author/name)
                                  :date (some-> c :git.commit/authored-at str)})
                               (take 5 commits))}))))
