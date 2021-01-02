server: server.ml
	ocamlfind ocamlopt -o server -thread -package opium,core,stdio server.ml -linkpkg

clean:
	rm server.o server.cmx server.cmi

setup:
	brew install coturn
	opam switch 4.11.1
	# opam install dune
	opam install opium core

run: server
	turnserver -v &
	./server

setup_server:
	# https://www.digitalocean.com/community/tutorials/initial-server-setup-with-ubuntu-20-04
	ssh root@facepals.fun
	adduser facepals
	usermod -aG sudo facepals
	rsync --archive --chown=facepals:facepals ~/.ssh /home/facepals
	logout
	ssh facepals@facepals.fun

	# https://certbot.eff.org/lets-encrypt/ubuntufocal-other
	sudo snap install core; sudo snap refresh core
	sudo apt-get remove certbot; sudo snap install --classic certbot
	sudo ln -s /snap/bin/certbot /usr/bin/certbot
	sudo certbot certonly --standalone
	#  - Congratulations! Your certificate and chain have been saved at:
  #  /etc/letsencrypt/live/facepals.fun/fullchain.pem
  #  Your key file has been saved at:
  #  /etc/letsencrypt/live/facepals.fun/privkey.pem
	sudo certbot renew --dry-run

	git clone https://github.com/brianhempel/facepals.fun.git

	# https://meetrix.io/blog/webrtc/coturn/installation.html
	sudo apt install coturn
	# uncomment TURNSERVER_ENABLED=1
	sudo vim /etc/default/coturn
	sudo chmod 777 /var/log
	sudo cp facepals.fun/turnserver.conf /etc/turnserver.conf
	sudo service coturn restart


