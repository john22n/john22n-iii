const http = require('http');

http.createServer(function (req, res) {
		res.write("fullstack engineer bitch");
		res.end();
	}
).listen(3000)

console.log('server started, 3000')
