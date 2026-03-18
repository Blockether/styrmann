(ns com.blockether.styrmann.domain.acceptance-criteria
  "Parsing and serialization for nested ticket acceptance criteria."
  (:require
   [clojure.edn :as edn]
   [clojure.string :as str]))

(defn- parse-line [line]
  (when-not (str/blank? line)
    (let [line (str/replace line #"\t" "  ")
          [_ indent bullet-text] (or (re-matches #"^(\s*)(?:[-*]|\d+\.)\s+(.*)$" line)
                                     [nil "" (str/trim line)])]
      {:level (quot (count indent) 2)
       :text  (str/trim bullet-text)})))

(defn- children-path [path]
  (vec (mapcat (fn [idx] [idx :children]) path)))

(defn- node-count [tree parent-path]
  (count (if (empty? parent-path)
           tree
           (get-in tree (children-path parent-path) []))))

(defn- append-node [tree parent-path node]
  (if (empty? parent-path)
    (conj tree node)
    (update-in tree (children-path parent-path) (fnil conj []) node)))

(defn parse-text
  "Parse indented bullet text into nested list data.

   Params:
   `text` - String. Multiline bullet list text.

   Returns:
   Vector of maps shaped as `{:text string :children [...]}`."
  [text]
  (let [items (->> (or text "")
                   str/split-lines
                   (keep parse-line)
                   vec)
        min-level (if (seq items) (apply min (map :level items)) 0)
        normalized (mapv #(update % :level - min-level) items)]
    (first
     (reduce (fn [[tree last-path] {:keys [level text]}]
               (let [effective-level (min level (count last-path))
                     parent-path (subvec last-path 0 effective-level)
                     new-index (node-count tree parent-path)
                     next-tree (append-node tree parent-path {:text text :children []})]
                 [next-tree (conj parent-path new-index)]))
             [[] []]
             normalized))))

(defn serialize
  "Serialize acceptance criteria data for persistence.

   Params:
   `criteria` - Nested vector structure.

   Returns:
   EDN string."
  [criteria]
  (pr-str criteria))

(defn deserialize
  "Deserialize acceptance criteria from persistence.

   Params:
   `criteria-edn` - String. Stored EDN text.

   Returns:
   Nested vector structure."
  [criteria-edn]
  (if (str/blank? criteria-edn)
    []
    (edn/read-string criteria-edn)))
