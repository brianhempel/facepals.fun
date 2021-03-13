open Opium

let global_counter = ref 0

let ensure_dir path =
  let open Lwt.Syntax in
  let* path_exists = Lwt_unix.file_exists path in
  if not path_exists then Core.Unix.mkdir_p path;
  Lwt.return ()

let with_dir path f =
  let open Lwt.Syntax in
  let* dir_handle = Lwt_unix.opendir path in
  Lwt.finalize
    (fun () -> f dir_handle)
    (fun () -> Lwt_unix.closedir dir_handle)

let names_in_dir path =
  let open Lwt.Syntax in
  with_dir path @@ fun dir_handle ->
    let* entries_array = Lwt_unix.readdir_n dir_handle 100_000_000 in
    entries_array
    |> Array.to_list
    |> List.filter (fun entry -> entry.[0] != '.')
    |> Lwt.return

let req_body_to_file req path =
  let open Lwt.Syntax in
  let dir_path = Core.Filename.dirname path in
  let* _ = ensure_dir dir_path in
  let* body_str = Body.to_string req.Request.body in
  (* let flags = if append = Some true then [Unix.O_APPEND; Unix.O_WRONLY] else [Unix.O_WRONLY] in *)
  (* Lwt_io.with_file ~mode:Lwt_io.Output path @@ fun out_chan -> *)
  (* Lwt_io.with_temp_file @@ fun (temp_path, out_chan) ->
    let* _ =
      Lwt_io.write_from_string_exactly
        out_chan
        body_str
        0 (String.length body_str)
    in
    Lwt_unix.rename temp_path path *)
  let* (temp_path, out_chan) = Lwt_io.open_temp_file () in
  Lwt.finalize
    (fun () ->
      let* _ =
        Lwt_io.write_from_string_exactly
          out_chan
          body_str
          0 (String.length body_str)
      in
      Lwt_unix.rename temp_path path)
    (fun () -> Lwt_io.close out_chan)


let respond_with_json_file path =
  let open Lwt.Syntax in
  let* path_exists = Lwt_unix.file_exists path in
  if not path_exists then
    Response.of_plain_text ~status:`Not_found "Not found"
    |> Lwt.return
  else
    let* str = Lwt_io.with_file ~mode:Lwt_io.Input path Lwt_io.read in
    Response.make
      ~body:(Body.of_string str)
      ~headers:(Headers.of_list [("content-type", "application/json")])
      ()
    |> Lwt.return

let respond_with_known_html path =
  let open Lwt.Syntax in
  let* str = Lwt_io.with_file ~mode:Lwt_io.Input path Lwt_io.read in
  Response.make
    ~body:(Body.of_string str)
    ~headers:(Headers.of_list [("content-type", "text/html")])
    ()
  |> Lwt.return

let new_peer_name req =
  let room_name = Router.param req "room_name" in
  let random_name =
    Format.sprintf "%02x%02x%02x%02x-%02x%02x%02x%02x-%02x%02x%02x%02x-%02x%02x%02x%02x" (Random.int 256) (Random.int 256) (Random.int 256) (Random.int 256) (Random.int 256) (Random.int 256) (Random.int 256) (Random.int 256) (Random.int 256) (Random.int 256) (Random.int 256) (Random.int 256) (Random.int 256) (Random.int 256) (Random.int 256) (Random.int 256)
  in
  Core.Unix.mkdir_p (Core.Filename.of_parts ["rooms"; room_name; "peers"; random_name]);
  (* Stdio.Out_channel.write_all (Core.Filename.of_parts ["rooms"; room_name; "peers"; random_name]) ""; *)
  Response.of_json (`Assoc [ "peer_name", `String random_name ])
  |> Lwt.return

let list_peers req =
  let room_name = Router.param req "room_name" in
  let peers_dir_path = Core.Filename.of_parts ["rooms"; room_name; "peers"] in
  let open Lwt.Syntax in
  let* path_exists = Lwt_unix.file_exists peers_dir_path in
  let* peer_names =
    if path_exists then
      names_in_dir peers_dir_path
    else
      Lwt.return []
  in
  Response.of_json (`Assoc [ "peers", `List (List.map (fun name -> `String name) peer_names) ])
  |> Lwt.return


let is_dir path =
  let open Lwt.Syntax in
  let* stat = Lwt_unix.stat path in
  Lwt.return (stat.st_kind == S_DIR)

let rec rm_r dir_path =
  let open Lwt.Syntax in
  let* names = names_in_dir dir_path in
  let* _ = rm_all @@ List.map (fun name -> Core.Filename.concat dir_path name) names in
  Lwt_unix.rmdir dir_path
and rm_all = function
| []          -> Lwt.return ()
| path::paths ->
  let open Lwt.Syntax in
  let* is_dir = is_dir path in
  let* _ = if is_dir then rm_r path else Lwt_unix.unlink path in
  rm_all paths

let remove_peer req =
  let room_name      = Router.param req "room_name" in
  let peer_name      = Router.param req "peer_name" in
  let peer_dir_path  = Core.Filename.of_parts ["rooms"; room_name; "peers"; peer_name] in
  let open Lwt.Syntax in
  let* path_exists = Lwt_unix.file_exists peer_dir_path in
  Lwt.async (fun () -> rm_r peer_dir_path);
  Lwt.return (Response.make ())

let peer_heartbeat req =
  let room_name      = Router.param req "room_name" in
  let peer_name      = Router.param req "peer_name" in
  let peers_dir_path = Core.Filename.of_parts ["rooms"; room_name; "peers"] in
  let peer_dir_path  = Core.Filename.of_parts ["rooms"; room_name; "peers"; peer_name] in
  let open Lwt.Syntax in
  let* path_exists = Lwt_unix.file_exists peer_dir_path in
  if path_exists then begin
    Lwt.async (fun () -> Lwt_unix.utimes peer_dir_path 0.0 0.0);
    (* Take this opportunity to check another peer for timeout. *)
    let* peerNames = names_in_dir peers_dir_path in
    let peerNames = List.filter (fun name -> name <> peer_name) peerNames in
    if List.length peerNames > 0 then
      let peer_name_to_check = List.nth peerNames (Random.int (List.length peerNames)) in
      let peer_dir_path_to_check = Core.Filename.of_parts ["rooms"; room_name; "peers"; peer_name_to_check] in
      let* peerStat = Lwt_unix.stat peer_dir_path_to_check in
      let age_seconds = Unix.time () -. peerStat.st_mtime in
      (* print_endline (string_of_float age_seconds); *)
      if age_seconds > 20.0 then
        Lwt.async (fun () -> rm_r peer_dir_path_to_check);
      Lwt.return (Response.make ())
    else
      Lwt.return (Response.make ())
  end else
    Lwt.return (Response.make ())


let new_peer_offer req =
  let room_name = Router.param req "room_name" in
  let target_peer_name = Router.param req "peer_name" in
  let offering_peer_name = Router.param req "offering_peer_name" in
  let open Lwt.Syntax in
  let* _ = req_body_to_file req (Core.Filename.of_parts ["rooms"; room_name; "peers"; target_peer_name; "offers"; offering_peer_name]) in
  Response.make () |> Lwt.return

let get_peer_offer req =
  let room_name = Router.param req "room_name" in
  let target_peer_name = Router.param req "peer_name" in
  let offering_peer_name = Router.param req "offering_peer_name" in
  respond_with_json_file @@ Core.Filename.of_parts ["rooms"; room_name; "peers"; target_peer_name; "offers"; offering_peer_name]

let new_peer_answer req =
  let room_name = Router.param req "room_name" in
  let target_peer_name = Router.param req "peer_name" in
  let answering_peer_name = Router.param req "answering_peer_name" in
  let open Lwt.Syntax in
  let* _ = req_body_to_file req (Core.Filename.of_parts ["rooms"; room_name; "peers"; target_peer_name; "answers"; answering_peer_name;]) in
  Response.make () |> Lwt.return

let get_peer_answer req =
  let room_name = Router.param req "room_name" in
  let target_peer_name = Router.param req "peer_name" in
  let answering_peer_name = Router.param req "answering_peer_name" in
  respond_with_json_file @@ Core.Filename.of_parts ["rooms"; room_name; "peers"; target_peer_name; "answers"; answering_peer_name]

let new_ice_candidate req =
  let room_name = Router.param req "room_name" in
  let target_peer_name = Router.param req "peer_name" in
  let sending_peer_name = Router.param req "sending_peer_name" in
  let open Lwt.Syntax in
  let n = !global_counter in
  incr global_counter;
  let* _ = req_body_to_file req (Core.Filename.of_parts ["rooms"; room_name; "peers"; target_peer_name; "ice_candidates"; sending_peer_name; string_of_int n ]) in
  Response.make () |> Lwt.return

let list_ice_candidate_ids req =
  let room_name = Router.param req "room_name" in
  let target_peer_name = Router.param req "peer_name" in
  let sending_peer_name = Router.param req "sending_peer_name" in
  let candidates_dir_path = Core.Filename.of_parts ["rooms"; room_name; "peers"; target_peer_name; "ice_candidates"; sending_peer_name] in
  let open Lwt.Syntax in
  let* path_exists = Lwt_unix.file_exists candidates_dir_path in
  if path_exists then
    let* ice_candidate_ids = names_in_dir candidates_dir_path in
    let ice_candidate_ids = ice_candidate_ids |> List.sort (fun name1 name2 -> Int.compare (int_of_string name1) (int_of_string name2)) in
    Response.of_json (`Assoc [ "ice_candidate_ids", `List (List.map (fun name -> `String name) ice_candidate_ids) ])
    |> Lwt.return
  else
    Response.of_plain_text ~status:`Not_found "Not found"
    |> Lwt.return

let get_ice_candidate req =
  let room_name = Router.param req "room_name" in
  let target_peer_name = Router.param req "peer_name" in
  let sending_peer_name = Router.param req "sending_peer_name" in
  let ice_candidate_id = Router.param req "ice_candidate_id" in
  respond_with_json_file @@ Core.Filename.of_parts ["rooms"; room_name; "peers"; target_peer_name; "ice_candidates"; sending_peer_name; ice_candidate_id]


(* Change to none during dev, but don't commit. *)
let static_etag_opt =
  (* None *)
  Some (Stdio.In_channel.read_all ".git/refs/heads/main" |> String.trim)

(*
  The protocol is to:

  1. Acquire a peer name by POSTing to /rooms/:room_name/peers

  2. Poll /rooms/:room_name/peers

  3. When a peer is listed that you haven't connected to, it is the
     responsibility of the lexigraphically lower peer_name to offer, so:

  4a. If other_peer_name < my_peer_name, then:
    (i)  Post my JSON RTCPeerConnectionDescription offer to
         /rooms/ROOM_NAME/peers/OTHER_PEER_NAME/offers/MY_PEER_NAME
    (ii) Poll /rooms/ROOM_NAME/peers/MY_PEER_NAME/answers/OTHER_PEER_NAME
         for the answering description

  4b. If other_peer_name > my_peer_name, then:
    (i)  Poll /rooms/ROOM_NAME/peers/MY_PEER_NAME/offers/OTHER_PEER_NAME for the offer
    (ii) Post my JSON RTCPeerConnectionDescription answer to
         /rooms/ROOM_NAME/peers/OTHER_PEER_NAME/answers/MY_PEER_NAME
 *)

let _ =
  Random.self_init ();
  Logs.set_reporter (Logs_fmt.reporter ());
  (* Logs.set_level (Some Logs.Debug); *)
  Logs.set_level (Some Logs.Info);
  App.empty
  |> App.middleware (Middleware.logger)
  |> App.middleware (Middleware.static_unix ~local_path:"./static" ~uri_prefix:"/static" ~etag_of_fname:(fun _ -> static_etag_opt) ())
  |> App.get "/"                 (fun _ -> respond_with_known_html (Core.Filename.of_parts ["static"; "new_room.html"]))
  |> App.get "/rooms/:room_name" (fun _ -> respond_with_known_html (Core.Filename.of_parts ["static"; "game.html"]))
  |> App.post "/rooms/:room_name/peers" new_peer_name
  |> App.get "/rooms/:room_name/peers" list_peers
  |> App.post "/rooms/:room_name/peers/:peer_name/remove" remove_peer (* Would use DELETE method, but JS navigator.sendBeacon is POST-only *)
  |> App.post "/rooms/:room_name/peers/:peer_name/heartbeat" peer_heartbeat
  |> App.post "/rooms/:room_name/peers/:peer_name/offers/:offering_peer_name" new_peer_offer
  |> App.get "/rooms/:room_name/peers/:peer_name/offers/:offering_peer_name" get_peer_offer
  |> App.post "/rooms/:room_name/peers/:peer_name/answers/:answering_peer_name" new_peer_answer
  |> App.get "/rooms/:room_name/peers/:peer_name/answers/:answering_peer_name" get_peer_answer
  |> App.post "/rooms/:room_name/peers/:peer_name/ice_candidates/:sending_peer_name" new_ice_candidate
  |> App.get "/rooms/:room_name/peers/:peer_name/ice_candidates/:sending_peer_name" list_ice_candidate_ids
  |> App.get "/rooms/:room_name/peers/:peer_name/ice_candidates/:sending_peer_name/:ice_candidate_id" get_ice_candidate
  |> App.run_command
;;