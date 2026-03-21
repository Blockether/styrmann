(ns com.blockether.styrmann.bootstrap
  "Auto-derive organization and workspace from the git remote of the current directory."
  (:require
   [clojure.java.shell :as sh]
   [clojure.string :as str]
   [com.blockether.styrmann.db.organization :as db.organization]
   [com.blockether.styrmann.domain.organization :as organization]
   [taoensso.telemere :as t]))

(defn- git-remote-url
  "Read the origin remote URL from the current git repo. Returns nil if not a git repo."
  []
  (let [{:keys [exit out]} (sh/sh "git" "remote" "get-url" "origin")]
    (when (zero? exit)
      (str/trim out))))

(defn- parse-remote
  "Parse org name and repo name from a git remote URL.

   Supports:
   - git@github.com:Blockether/styrmann.git
   - https://github.com/Blockether/styrmann.git
   - https://github.com/Blockether/styrmann

   Returns {:org \"Blockether\" :repo \"styrmann\"} or nil."
  [url]
  (when url
    (let [;; SSH format: git@host:org/repo.git
          ssh-match (re-find #"[^/]+:([^/]+)/([^/]+?)(?:\.git)?$" url)
          ;; HTTPS format: https://host/org/repo.git
          https-match (re-find #"https?://[^/]+/([^/]+)/([^/]+?)(?:\.git)?$" url)]
      (when-let [[_ org repo] (or ssh-match https-match)]
        {:org org :repo repo}))))

(defn ensure-from-git!
  "If the current directory is a git repo, ensure an organization and workspace
   exist matching the remote origin. Idempotent — skips creation if they exist.

   Params:
   `conn` - Datalevin connection.

   Returns:
   Map with :organization and :workspace, or nil if not a git repo."
  [conn]
  (when-let [remote (git-remote-url)]
    (when-let [{:keys [org repo]} (parse-remote remote)]
      (let [normalized-name (fn [s] (str (str/upper-case (subs s 0 1)) (subs s 1)))
            organizations (organization/list-organizations conn)
            existing-org (first (filter #(= org (:organization/name %)) organizations))
            organization (or existing-org
                             (do (t/log! :info ["Bootstrap: creating organization from git remote" {:name org}])
                                 (organization/create! conn {:name org})))
            org-id (:organization/id organization)
            ws-name (normalized-name repo)
            workspaces (db.organization/list-workspaces conn org-id)
            existing-ws (first (filter #(or (= ws-name (:workspace/name %))
                                            (= repo (:workspace/name %))) workspaces))
            cwd (.getAbsolutePath (java.io.File. "."))
            workspace (or existing-ws
                          (do (t/log! :info ["Bootstrap: creating workspace from git remote" {:name ws-name :repository cwd}])
                              (organization/create-workspace!
                               conn
                               {:organization-id org-id
                                :name ws-name
                                :repository cwd})))]
        (when (and (not existing-org) (not existing-ws))
          (t/log! :info ["Bootstrap complete" {:organization org :workspace repo}]))
        {:organization organization :workspace workspace}))))
