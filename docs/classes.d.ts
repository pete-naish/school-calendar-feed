// Types for classes.js, which stays plain JS because scripts/build_ics.py parses
// it as JSON. tests/test_classes_config.py checks the file itself matches.
export interface ClassConfig {
  code: string;
  label: string;
}

export interface YearGroupConfig {
  key: string;
  label: string;
  number: string;
  classes: ClassConfig[];
}

declare const CLASSES: { yearGroups: YearGroupConfig[] };
export default CLASSES;
