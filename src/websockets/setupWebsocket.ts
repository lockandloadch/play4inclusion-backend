import {io} from "../app";

export default function setupWebsocket(sessionMiddleware, passport) {
    function onlyForHandshake(middleware) {
        return (req, res, next) => {
            console.log("ATTEMPT");
            const isHandshake = req._query.sid === undefined;
            if (isHandshake) {
                try {
                    middleware(req, res, next);
                } catch (error) {
                    res.writeHead(401);
                    res.end();
                }
            } else {
                next();
            }
        };
    }

    io.engine.use(onlyForHandshake(sessionMiddleware));
    io.engine.use(onlyForHandshake(passport.session()));
    io.engine.use(
        onlyForHandshake((req, res, next) => {
            if (req.user) {
                next();
            } else {
                res.writeHead(401);
                res.end();
            }
        }),
    );
}