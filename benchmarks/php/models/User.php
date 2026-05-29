<?php

namespace app\models;

use Yii;
use yii\db\ActiveRecord;
use yii\web\IdentityInterface;

/**
 * User model for authentication and profile management.
 *
 * @property int $id
 * @property string $email
 * @property string $password_hash
 * @property string $auth_key
 * @property int $status
 * @property string $verification_token
 * @property string $password_reset_token
 * @property int $two_factor_enabled
 * @property string $created_at
 * @property string $updated_at
 */
class User extends ActiveRecord implements IdentityInterface
{
    const STATUS_PENDING = 0;
    const STATUS_ACTIVE = 1;
    const STATUS_BLOCKED = 10;

    public $password;

    public static function tableName()
    {
        return '{{%user}}';
    }

    public function rules()
    {
        return [
            ['email', 'required'],
            ['email', 'email'],
            ['email', 'unique'],
            ['password', 'required', 'on' => 'register'],
            ['password', 'string', 'min' => 8],
            ['status', 'in', 'range' => [self::STATUS_PENDING, self::STATUS_ACTIVE, self::STATUS_BLOCKED]],
        ];
    }

    // --- IdentityInterface ---

    public static function findIdentity($id)
    {
        return static::findOne(['id' => $id, 'status' => self::STATUS_ACTIVE]);
    }

    public static function findIdentityByAccessToken($token, $type = null)
    {
        return static::findOne(['auth_key' => $token, 'status' => self::STATUS_ACTIVE]);
    }

    public function getId() { return $this->id; }
    public function getAuthKey() { return $this->auth_key; }
    public function validateAuthKey($authKey) { return $this->auth_key === $authKey; }

    // --- Finders ---

    public static function findByEmail($email)
    {
        return static::findOne(['email' => $email]);
    }

    public static function findByVerificationToken($token)
    {
        return static::findOne([
            'verification_token' => $token,
            'status' => self::STATUS_PENDING,
        ]);
    }

    public static function findByPasswordResetToken($token)
    {
        $user = static::findOne(['password_reset_token' => $token]);
        if (!$user || !$user->isPasswordResetTokenValid()) {
            return null;
        }
        return $user;
    }

    // --- Password ---

    public function setPassword($password)
    {
        $this->password_hash = Yii::$app->security->generatePasswordHash($password);
    }

    public function validatePassword($password)
    {
        return Yii::$app->security->validatePassword($password, $this->password_hash);
    }

    // --- Tokens ---

    public function generateAuthKey()
    {
        $this->auth_key = Yii::$app->security->generateRandomString();
    }

    public function generateVerificationToken()
    {
        $this->verification_token = Yii::$app->security->generateRandomString() . '_' . time();
    }

    public function generatePasswordResetToken()
    {
        $this->password_reset_token = Yii::$app->security->generateRandomString() . '_' . time();
    }

    protected function isPasswordResetTokenValid()
    {
        if (empty($this->password_reset_token)) return false;
        $timestamp = (int) substr($this->password_reset_token, strrpos($this->password_reset_token, '_') + 1);
        return $timestamp + 3600 >= time(); // 1 hour expiry
    }
}
