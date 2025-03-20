const express = require("express");
const app = express();
const multer = require('multer');
const axios = require('axios');
const FormData = require('form-data');
require('dotenv').config();  // .env 파일 로드
const path = require('path');

// Express 설정
app.use(express.static('public'));
app.use(express.urlencoded({extended: true}));
app.use(express.json());

// View 엔진 설정
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Bunny.net 설정
const BUNNY_STORAGE_ZONE = process.env.BUNNY_STORAGE_ZONE;
const BUNNY_ACCESS_KEY = process.env.BUNNY_ACCESS_KEY;
const BUNNY_PULL_ZONE = process.env.BUNNY_PULL_ZONE;

// multer 설정
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

const { MongoClient, ObjectId } = require('mongodb')
let db
const url = process.env.DB_URL;

// MongoDB 연결
async function connectDB() {
    try {
        if (!process.env.DB_URL) {
            throw new Error('Database URL is not defined in environment variables');
        }
        
        const client = await MongoClient.connect(process.env.DB_URL, {
            serverSelectionTimeoutMS: 5000
        });
        
        console.log('MongoDB 연결 성공');
        return client.db('forum');
    } catch (err) {
        console.error('MongoDB 연결 에러:', err);
        throw err;
    }
}

// 서버 시작
const port = process.env.PORT || 3000;
app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
    // 초기 DB 연결 시도
    connectDB().catch(console.error);
});

// Vercel/Render 서버리스 함수를 위한 export
module.exports = app;

app.get('/', function(req, res){
    res.redirect('/list');
});

app.get('/list', async (req, res) => {
    try {
        const database = await connectDB();
        const page = parseInt(req.query.page) || 1;
        const limit = 10; // 페이지당 게시물 수
        const skip = (page - 1) * limit;

        // 전체 게시물 수 조회
        const totalPosts = await database.collection('post').countDocuments();
        const totalPages = Math.ceil(totalPosts / limit);

        // 게시물 목록 조회 (페이지네이션 적용)
        const 글목록 = await database.collection('post').find()
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .toArray();

        res.render('list', { 
            글목록,
            totalPages,
            currentPage: page
        });
    } catch (error) {
        console.error('Error in /list:', error);
        res.status(500).send('게시물 목록을 불러오는데 실패했습니다.');
    }
});

app.get('/write', function(req, res){
    res.render('write.ejs')
})

app.post('/write', upload.single('image'), async (req, res) => {
    try {
        const database = await connectDB();
        console.log('=== Write Route Start ===');
        console.log('Request body:', req.body);
        console.log('Request file:', req.file ? {
            originalname: req.file.originalname,
            mimetype: req.file.mimetype,
            size: req.file.size
        } : 'No file uploaded');
        
        let imageUrl = null;
        
        // 이미지가 있는 경우 업로드 처리
        if (req.file) {
            const file = req.file;
            // 파일명에서 한글과 특수문자 제거, 확장자만 유지
            const originalName = file.originalname;
            const extension = originalName.split('.').pop().toLowerCase();
            const sanitizedName = originalName.replace(/[^a-zA-Z0-9.]/g, '_');
            const timestamp = Date.now();
            const fileName = `${timestamp}_${sanitizedName}`;
            
            console.log('=== File Processing ===');
            console.log('Original filename:', originalName);
            console.log('File extension:', extension);
            console.log('Sanitized filename:', fileName);
            
            try {
                const uploadUrl = `https://sg.storage.bunnycdn.com/${BUNNY_STORAGE_ZONE}/${fileName}`;
                console.log('Attempting upload to:', uploadUrl);
                console.log('Using AccessKey:', BUNNY_ACCESS_KEY.substring(0, 10) + '...');
                
                // 파일 버퍼 확인
                if (!file.buffer || file.buffer.length === 0) {
                    throw new Error('File buffer is empty');
                }

                const response = await axios.put(
                    uploadUrl,
                    file.buffer,
                    {
                        headers: {
                            'AccessKey': BUNNY_ACCESS_KEY,
                            'Content-Type': file.mimetype
                        },
                        maxContentLength: Infinity,
                        maxBodyLength: Infinity
                    }
                );
                
                console.log('Upload response:', {
                    status: response.status,
                    statusText: response.statusText,
                    headers: response.headers
                });
                
                // 200 또는 201 상태 코드 모두 성공으로 처리
                if (response.status === 200 || response.status === 201) {
                    imageUrl = `${BUNNY_PULL_ZONE}/${fileName}`;
                    console.log('Successfully generated image URL:', imageUrl);
                } else {
                    throw new Error(`Upload failed with status ${response.status}`);
                }
            } catch (error) {
                console.error('=== Bunny.net Upload Error ===');
                console.error('Error message:', error.message);
                console.error('Error response:', {
                    status: error.response?.status,
                    statusText: error.response?.statusText,
                    data: error.response?.data
                });
                return res.status(500).json({ 
                    success: false, 
                    message: '이미지 업로드에 실패했습니다.',
                    error: error.response?.data || error.message
                });
            }
        }

        // 태그 처리
        const tags = req.body.tags ? req.body.tags.split(',').map(tag => tag.trim()).filter(tag => tag) : [];
        console.log('Processed tags:', tags);

        // 게시물 저장
        const post = {
            title: req.body.title,
            content: req.body.content,
            category: req.body.category,
            author: req.body.author || '익명',
            imageUrl: imageUrl,
            tags: tags,
            views: 0,
            likes: 0,
            createdAt: new Date(),
            updatedAt: new Date()
        };

        console.log('=== Saving Post to Database ===');
        console.log('Post data:', post);

        const result = await database.collection('post').insertOne(post);
        console.log('Database save result:', result);

        res.status(200).json({ 
            success: true,
            message: '게시물이 성공적으로 작성되었습니다.',
            postId: result.insertedId
        });
    } catch (error) {
        console.error('=== Write Route Error ===');
        console.error('Error:', error);
        res.status(500).json({ 
            success: false, 
            message: '게시물 작성에 실패했습니다.',
            error: error.message
        });
    }
});

app.get('/detail/:id', async (req, res) => {
    try {
        const database = await connectDB();
        const postId = req.params.id;
        
        // 게시물 조회
        const post = await database.collection('post').findOne({ _id: new ObjectId(postId) });
        
        if (!post) {
            return res.status(404).render('error', { message: '게시물을 찾을 수 없습니다.' });
        }

        // 조회수 증가
        await database.collection('post').updateOne(
            { _id: new ObjectId(postId) },
            { $inc: { views: 1 } }
        );

        // 업데이트된 게시물 다시 조회
        const updatedPost = await database.collection('post').findOne({ _id: new ObjectId(postId) });

        res.render('detail', { 글내용: updatedPost });
    } catch (error) {
        console.error('Detail Route Error:', error);
        res.status(500).render('error', { message: '게시물을 불러오는 중 오류가 발생했습니다.' });
    }
});

app.put('/edit/:id', async (req, res) => {
    try {
        const database = await connectDB();
        const result = await database.collection('post').updateOne(
            { _id: new ObjectId(req.params.id) },
            { $set: req.body }
        );
        if (result.modifiedCount === 0) {
            return res.json({ success: false, message: '수정할 게시물을 찾을 수 없습니다.' });
        }
        res.json({ success: true });
    } catch (error) {
        console.error('Error updating post:', error);
        res.json({ success: false, message: '게시물 수정에 실패했습니다.' });
    }
});

app.delete('/delete/:id', async (req, res) => {
    try {
        const database = await connectDB();
        const result = await database.collection('post').deleteOne({ _id: new ObjectId(req.params.id) });
        if (result.deletedCount === 0) {
            return res.json({ success: false, message: '삭제할 게시물을 찾을 수 없습니다.' });
        }
        res.json({ success: true });
    } catch (error) {
        console.error('Error deleting post:', error);
        res.json({ success: false, message: '게시물 삭제에 실패했습니다.' });
    }
});

// 이미지 업로드 API
app.post('/upload', upload.single('image'), async function(req, res) {
    try {
        console.log('=== Upload Route Start ===');
        console.log('Request file:', req.file ? {
            originalname: req.file.originalname,
            mimetype: req.file.mimetype,
            size: req.file.size
        } : 'No file uploaded');

        if (!req.file) {
            return res.json({ success: false, message: '이미지가 선택되지 않았습니다.' });
        }

        // 파일 이름에서 한글과 특수문자 제거
        const originalName = req.file.originalname;
        const sanitizedName = originalName.replace(/[^a-zA-Z0-9.]/g, '_');
        const timestamp = Date.now();
        const fileName = `${timestamp}_${sanitizedName}`;

        console.log('=== File Processing ===');
        console.log('Original filename:', originalName);
        console.log('Sanitized filename:', fileName);

        const storageUrl = `https://sg.storage.bunnycdn.com/${BUNNY_STORAGE_ZONE}/`;
        const fileUrl = storageUrl + fileName;

        console.log('=== Upload Attempt ===');
        console.log('Upload URL:', fileUrl);
        console.log('Using AccessKey:', BUNNY_ACCESS_KEY.substring(0, 10) + '...');

        const response = await axios.put(fileUrl, req.file.buffer, {
            headers: {
                'AccessKey': BUNNY_ACCESS_KEY,
                'Content-Type': req.file.mimetype
            }
        });

        console.log('Upload response:', {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers
        });

        // 수정된 이미지 URL 생성
        const imageUrl = `${BUNNY_PULL_ZONE}/${fileName}`;
        console.log('Generated image URL:', imageUrl);

        res.json({ 
            success: true, 
            imageUrl: imageUrl 
        });
    } catch (error) {
        console.error('=== Upload Route Error ===');
        console.error('Error message:', error.message);
        console.error('Error response:', {
            status: error.response?.status,
            statusText: error.response?.statusText,
            data: error.response?.data
        });
        res.json({ 
            success: false, 
            message: '이미지 업로드 중 오류가 발생했습니다.',
            error: error.response?.data || error.message
        });
    }
});

// 좋아요 API
app.post('/api/like/:id', async (req, res) => {
    try {
        const database = await connectDB();
        const postId = req.params.id;
        
        // 현재 게시물 조회
        const post = await database.collection('post').findOne({ _id: new ObjectId(postId) });
        
        if (!post) {
            return res.status(404).json({ success: false, message: '게시물을 찾을 수 없습니다.' });
        }

        // 현재 좋아요 수를 토글 (0이면 1로, 1이면 0으로)
        const newLikes = post.likes === 1 ? 0 : 1;
        
        // 좋아요 수 업데이트
        await database.collection('post').updateOne(
            { _id: new ObjectId(postId) },
            { $set: { likes: newLikes } }
        );

        res.json({ 
            success: true, 
            likes: newLikes
        });
    } catch (error) {
        console.error('Like error:', error);
        res.status(500).json({ success: false, message: '좋아요 처리 중 오류가 발생했습니다.' });
    }
});
