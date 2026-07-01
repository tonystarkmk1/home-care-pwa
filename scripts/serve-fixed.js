const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const source = path.join(root, 'server2.js');
const target = path.join(root, '.runtime-server.js');

let code = fs.readFileSync(source, 'utf8');
code = code.replace(
  "app.use(express.json({limit:'10mb'}),express.urlencoded({extended:true}),'/uploads',express.static(ABS_UPLOAD_DIR),express.static(path.join(__dirname,'public')));",
  "app.use(express.json({limit:'10mb'}));\napp.use(express.urlencoded({extended:true}));\napp.use('/uploads', express.static(ABS_UPLOAD_DIR));\napp.use(express.static(path.join(__dirname,'public')));"
);

fs.writeFileSync(target, code);
require(target);
