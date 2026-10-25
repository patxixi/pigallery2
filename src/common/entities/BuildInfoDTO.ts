export interface BuildInfoDTO {
  version: string;
  branch: string; // empty if not known (e.g.: development build)
  commit: string; // short hash
  time: string; // ISO date of the build
}
