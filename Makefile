server: server.ml
	ocamlfind ocamlopt -o server -thread -package opium,core,stdio server.ml -linkpkg

clean:
	rm server.o server.cmx server.cmi

dev_setup:
	# brew install coturn
	sh <(curl -sL https://raw.githubusercontent.com/ocaml/opam/master/shell/install.sh)
	opam switch create 4.11.1
	eval $(opam env)
	# opam install dune
	opam install opium core

run: server
	ulimit -S -n $(ulimit -Hn); ./server

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
	# Add AmbientCapabilities=CAP_NET_BIND_SERVICE to [Service] section
	# https://github.com/coturn/coturn/issues/421#issuecomment-597552224
	sudo vim /lib/systemd/system/coturn.service
	sudo systemctl daemon-reload
	sudo service coturn restart

	# Need swap space to build OCaml
	# https://linuxize.com/post/how-to-add-swap-space-on-ubuntu-20-04/
	sudo fallocate -l 2G /swapfile
	sudo chmod 600 /swapfile
	sudo mkswap /swapfile
	sudo swapon /swapfile
	sudo sh -c "echo '/swapfile swap swap defaults 0 0' >> /etc/fstab"

	sudo apt install opam
	opam init
	opam switch create 4.11.1
	eval $(opam env)
	sudo apt install libev-dev pkg-config
	opam install ocamlfind opium core
	cd facepals.fun && make

	sudo apt install haproxy
	sudo sh -c "cat /etc/letsencrypt/live/facepals.fun/fullchain.pem /etc/letsencrypt/live/facepals.fun/privkey.pem > /etc/ssl/private/facepals.fun.pem"
	sudo cp facepals.fun/haproxy.cfg /etc/haproxy/haproxy.cfg
	sudo service haproxy restart




