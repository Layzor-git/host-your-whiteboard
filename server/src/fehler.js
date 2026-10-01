/**
 * Domain errors with a fixed code.
 *
 * The app translates the code into the selected language (web/src/i18n,
 * key "error.<code>"). The English sentence is defined here; it goes into
 * the response and is meant for anyone using the API without the app.
 *
 * No stack trace, no database field name. Whoever throws an error has
 * checked an input and says what is wrong with it.
 */
export const MELDUNGEN = {
  not_found: 'Not found.',
  no_permission: "You don't have permission for this.",

  image_empty: 'No image data received.',
  image_too_large: 'The image is too large (max. 20 MB).',
  image_format: 'Unknown image format. Allowed are PNG, JPEG, WebP and GIF.',
  image_id_invalid: 'Invalid image id.',
  image_not_found: 'This image does not exist.',

  board_name_missing: 'A board needs a name.',
  board_name_too_long: 'The name is too long (max. 200 characters).',
  canvas_color_unknown: 'Unknown canvas color.',
  pattern_unknown: 'Unknown pattern.',
  board_data_invalid: 'Board data without element list.',
  board_id_invalid: 'Invalid board id.',
  board_not_found: 'This board does not exist.',
  preview_format: 'The preview must be a PNG, WebP or JPEG image.',
  preview_too_large: 'The preview image is too large.',
  preview_missing: 'No preview.',
  delete_only_from_trash: 'Only boards in the trash can be deleted permanently.',

  folder_name_missing: 'A folder needs a name.',
  folder_name_too_long: 'The name is too long (max. 120 characters).',
  folder_not_found: 'This folder does not exist.',
  folder_not_in_trash: 'This folder is not in the trash.',
  folder_cycle: 'A folder cannot be moved into itself or one of its subfolders.',
  undo_expired: 'This can no longer be undone.',

  email_invalid: 'This is not a valid email address.',
  permission_unknown: 'Unknown permission.',
  board_already_yours: 'This board already belongs to you.',
  folder_already_yours: 'This folder already belongs to you.',
  only_owner_board: 'Only the owner of this board can do that.',
  only_owner_folder: 'Only the owner of this folder can do that.',
  view_only_board: 'You can only view this board.',
  view_only_folder: 'You can only view this folder.',
  only_owner_removes_board: 'Only the board owner can remove others.',
  only_owner_removes_folder: 'Only the folder owner can remove others.',
  only_shared_root_removable: 'Only the shared folder itself can be removed.',

  ops_not_list: 'ops must be a list.',
  op_element_invalid: 'Element without valid id or type.',
  op_delete_without_id: 'Delete without id.',
  op_background_invalid: 'Unknown background.',
  op_unknown: 'Unknown operation.',
};

class FachFehler extends Error {
  constructor(code, statusCode) {
    super(MELDUNGEN[code] ?? code);
    this.code = code;
    this.statusCode = statusCode;
  }
}

/** The input is invalid. */
export class Ungueltig extends FachFehler {
  constructor(code) {
    super(code, 400);
  }
}

/** Does not exist, or belongs to someone else. Both look the same. */
export class NichtGefunden extends FachFehler {
  constructor(code = 'not_found') {
    super(code, 404);
  }
}

/** Board is visible, but the permission is not enough (e.g. view only). */
export class KeinRecht extends FachFehler {
  constructor(code = 'no_permission') {
    super(code, 403);
  }
}
