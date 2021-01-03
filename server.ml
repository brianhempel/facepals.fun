open Opium

let ensure_dir path =
  let open Lwt.Syntax in
  let* path_exists = Lwt_unix.file_exists path in
  if not path_exists then Core.Unix.mkdir_p path;
  Lwt.return ()

let req_body_to_file req path =
  let open Lwt.Syntax in
  let dir_path = Core.Filename.dirname path in
  let* _ = ensure_dir dir_path in
  let* body_str = Body.to_string req.Request.body in
  (* let flags = if append = Some true then [Unix.O_APPEND; Unix.O_WRONLY] else [Unix.O_WRONLY] in *)
  Lwt_io.with_file ~mode:Lwt_io.Output path @@ fun out_chan ->
    Lwt_io.write_from_string_exactly
      out_chan
      body_str
      0 (String.length body_str)

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
  let* dir_handle = Lwt_unix.opendir peers_dir_path in
  let* entries_array = Lwt_unix.readdir_n dir_handle 100_000 in
  let peer_names = entries_array |> Array.to_list |> List.filter (fun entry -> entry.[0] != '.') in
  Response.of_json (`Assoc [ "peers", `List (List.map (fun name -> `String name) peer_names) ])
  |> Lwt.return

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
  let* _ = req_body_to_file req (Core.Filename.of_parts ["rooms"; room_name; "peers"; target_peer_name; "ice_candidates"; sending_peer_name; string_of_float (Unix.gettimeofday ()) ]) in
  Response.make () |> Lwt.return

let list_ice_candidate_ids req =
  let room_name = Router.param req "room_name" in
  let target_peer_name = Router.param req "peer_name" in
  let sending_peer_name = Router.param req "sending_peer_name" in
  let candidates_dir_path = Core.Filename.of_parts ["rooms"; room_name; "peers"; target_peer_name; "ice_candidates"; sending_peer_name] in
  let open Lwt.Syntax in
  let* dir_handle = Lwt_unix.opendir candidates_dir_path in
  let* entries_array = Lwt_unix.readdir_n dir_handle 100_000 in
  let ice_candidate_ids = entries_array |> Array.to_list |> List.filter (fun entry -> entry.[0] != '.') |> List.sort (fun name1 name2 -> Float.compare (float_of_string name1) (float_of_string name2)) in
  Response.of_json (`Assoc [ "ice_candidate_ids", `List (List.map (fun name -> `String name) ice_candidate_ids) ])
  |> Lwt.return

let get_ice_candidate req =
  let room_name = Router.param req "room_name" in
  let target_peer_name = Router.param req "peer_name" in
  let sending_peer_name = Routr.param req "sending_peer_name" in
  let ice_candidate_id = Router.param req "ice_candidate_id" in
  respond_with_json_file @@ Core.Filename.of_parts ["rooms"; room_name; "peers"; target_peer_name; "ice_candidates"; sending_peer_name; ice_candidate_id]

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
  Logs.set_level (Some Logs.Debug);
  App.empty
  |> App.middleware (Middleware.static_unix ~local_path:"./static" ~uri_prefix:"/static" ())
  |> App.post "/rooms/:room_name/peers" new_peer_name
  |> App.get "/rooms/:room_name/peers" list_peers
  |> App.post "/rooms/:room_name/peers/:peer_name/offers/:offering_peer_name" new_peer_offer
  |> App.get "/rooms/:room_name/peers/:peer_name/offers/:offering_peer_name" get_peer_offer
  |> App.post "/rooms/:room_name/peers/:peer_name/answers/:answering_peer_name" new_peer_answer
  |> App.get "/rooms/:room_name/peers/:peer_name/answers/:answering_peer_name" get_peer_answer
  |> App.post "/rooms/:room_name/peers/:peer_name/ice_candidates/:sending_peer_name" new_ice_candidate
  |> App.get "/rooms/:room_name/peers/:peer_name/ice_candidates/:sending_peer_name" list_ice_candidate_ids
  |> App.get "/rooms/:room_name/peers/:peer_name/ice_candidates/:sending_peer_name/:ice_candidate_id" get_ice_candidate
  |> App.run_command
;;