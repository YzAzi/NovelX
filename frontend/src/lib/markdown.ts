export const normalizeMarkdown = (input: string) => {
  if (!input) return "";
  let output = input.normalize("NFKC");
  // Normalize uncommon whitespace to ASCII spaces.
  output = output.replace(
    /[\u00a0\u1680\u180e\u2000-\u200b\u202f\u205f\u3000]/g,
    " ",
  );
  // Remove spaces right inside emphasis delimiters so "** text **" parses as bold.
  output = output.replace(/\*\*\s+([^*\n]+?)\s+\*\*/g, "**$1**");
  output = output.replace(/\*\*\s+([^*\n]+?)\*\*/g, "**$1**");
  output = output.replace(/\*\*([^*\n]+?)\s+\*\*/g, "**$1**");
  output = output.replace(/__\s+([^_\n]+?)\s+__/g, "__$1__");
  output = output.replace(/__\s+([^_\n]+?)__/g, "__$1__");
  output = output.replace(/__([^_\n]+?)\s+__/g, "__$1__");
  output = output.replace(/\*\s+([^*\n]+?)\s+\*/g, "*$1*");
  output = output.replace(/\*\s+([^*\n]+?)\*/g, "*$1*");
  output = output.replace(/\*([^*\n]+?)\s+\*/g, "*$1*");
  output = output.replace(/_\s+([^_\n]+?)\s+_/g, "_$1_");
  output = output.replace(/_\s+([^_\n]+?)_/g, "_$1_");
  output = output.replace(/_([^_\n]+?)\s+_/g, "_$1_");
  return output;
};
